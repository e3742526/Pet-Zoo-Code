import { delimiter, isAbsolute } from "node:path"
import * as vscode from "vscode"
import { z } from "zod"

import { isProviderName, providerIdentifiers, type OrganizationAllowList, type ProviderSettings } from "@roo-code/types"

import { getGitHubCopilotAccount } from "../../api/providers/github-copilot"
import { hasQwenCredentials } from "../../api/providers/qwen-code"
import {
	expandHomeDirectory,
	getCliSearchDirectories,
	resolveCliExecutable,
} from "../../api/providers/cli-subscription/executable"
import { buildCliEnvironment, runJsonlProcess } from "../../api/providers/cli-subscription/process"
import { settleOnAbort } from "../../api/providers/utils/abort-signal"
import { kimiCodeOAuthManager } from "../../integrations/kimi-code/oauth"
import { openAiCodexOAuthManager } from "../../integrations/openai-codex/oauth"
import { ProfileValidator } from "../../shared/ProfileValidator"
import { singleCompletionHandler } from "../../utils/single-completion-handler"

import { buildCommitMessagePrompt, getCommitMessage } from "./prompt"

export const DEFAULT_COMMIT_PROVIDER = "default"
const NATIVE_TIMEOUT_MS = 60_000
const DORY_TIMEOUT_MS = 360_000
const { openaiCodex, githubCopilot, kimiCode, qwenCode, vscodeLm, antigravity, museCode } = providerIdentifiers

export interface CommitProfile {
	id: string
	settings: ProviderSettings
}

interface ProfileRoute {
	kind: "service" | "cli" | "api"
	settings: ProviderSettings
}

interface DoryRoute {
	kind: "dory"
	provider: string
}

function toProfileRoute(settings: ProviderSettings): ProfileRoute | undefined {
	const provider = settings.apiProvider
	if (
		!isProviderName(provider) ||
		provider === providerIdentifiers.fakeAi ||
		provider === providerIdentifiers.geminiCli
	) {
		return undefined
	}
	if (
		provider === openaiCodex ||
		provider === githubCopilot ||
		provider === qwenCode ||
		provider === vscodeLm ||
		(provider === kimiCode && settings.kimiCodeAuthMethod !== "api-key")
	)
		return { kind: "service", settings }

	if (provider === antigravity || provider === museCode) return { kind: "cli", settings }

	return { kind: "api", settings }
}

function getRoutes(
	selection: string,
	profiles: CommitProfile[],
	allowList: OrganizationAllowList,
): (ProfileRoute | DoryRoute)[] {
	const profileRoute = (settings: ProviderSettings) =>
		ProfileValidator.isProfileAllowed(settings, allowList) ? toProfileRoute(settings) : undefined

	if (selection.startsWith("dory:")) {
		const provider = selection.slice("dory:".length)
		return provider && allowList.allowAll ? [{ kind: "dory", provider }] : []
	}
	if (selection !== DEFAULT_COMMIT_PROVIDER) {
		const profile = profiles.find(({ id }) => selection === `profile:${id}`)
		const route = profile && profileRoute(profile.settings)
		return route ? [route] : []
	}

	const routes = profiles.flatMap(({ settings }) => profileRoute(settings) ?? [])
	for (const apiProvider of [openaiCodex, githubCopilot, kimiCode, qwenCode, antigravity, museCode]) {
		const route = profileRoute({ apiProvider })
		if (
			route &&
			!routes.some((candidate) => candidate.kind === route.kind && candidate.settings.apiProvider === apiProvider)
		) {
			routes.push(route)
		}
	}

	return [
		...routes.filter(({ kind }) => kind === "service"),
		...routes.filter(({ kind }) => kind === "cli"),
		...(allowList.allowAll ? [{ kind: "dory" as const, provider: "auto" }] : []),
		...routes.filter(({ kind }) => kind === "api"),
	]
}

async function isSignedIn(settings: ProviderSettings): Promise<boolean> {
	switch (settings.apiProvider) {
		case openaiCodex:
			return openAiCodexOAuthManager.isAuthenticated()
		case githubCopilot:
			return Boolean(await getGitHubCopilotAccount())
		case kimiCode:
			return kimiCodeOAuthManager.isAuthenticated()
		case qwenCode:
			return hasQwenCredentials(settings.qwenCodeOauthPath)
		case vscodeLm:
			return (await vscode.lm.selectChatModels(settings.vsCodeLmModelSelector ?? {})).length > 0
		default:
			return false
	}
}

const doryResult = z.object({ success: z.literal(true), stdout: z.string() })

async function draftWithDory(provider: string, cwd: string, signal: AbortSignal) {
	const configured = vscode.workspace.getConfiguration("dory").inspect<string>("cliPath")?.globalValue?.trim()
	const path = configured && expandHomeDirectory(configured)
	const executable = await resolveCliExecutable(path && isAbsolute(path) ? path : undefined, "dory", "Dory")
	const args = ["session", "draft-commit", "--provider", provider, "--dry-run", "--json"]
	if (provider !== "auto") args.push("--no-fallback")
	const env = { ...buildCliEnvironment(), PATH: getCliSearchDirectories().join(delimiter) }

	let message: string | undefined
	for await (const item of runJsonlProcess({
		executable,
		args,
		cwd,
		signal,
		env,
		inactivityTimeoutMs: 0,
		label: "Dory",
	})) {
		if (item.type === "event") {
			const envelope = doryResult.safeParse(item.value)
			if (envelope.success) message = envelope.data.stdout
		} else {
			return item.exitCode === 0 ? message : undefined
		}
	}
	return undefined
}

interface DraftOptions {
	selection: string
	profiles: CommitProfile[]
	allowList: OrganizationAllowList
	patch: string
	cwd: string
	signal: AbortSignal
	beforeDory: () => Promise<boolean>
	log: (message: string) => void
}

export async function draftCommitMessage(options: DraftOptions): Promise<string | undefined> {
	const { selection, profiles, allowList, patch, cwd, signal, beforeDory, log } = options
	const prompt = buildCommitMessagePrompt(patch)
	for (const route of getRoutes(selection, profiles, allowList)) {
		signal.throwIfAborted()
		const label = route.kind === "dory" ? "Dory CLI" : route.settings.apiProvider
		// Dory reads the staged diff itself. Stop before forwarding if the index has changed.
		if (route.kind === "dory" && !(await beforeDory())) return undefined

		try {
			const timeoutMs = route.kind === "dory" ? DORY_TIMEOUT_MS : NATIVE_TIMEOUT_MS
			const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
			let raw: string | undefined
			if (route.kind === "dory") {
				raw = await draftWithDory(route.provider, cwd, attemptSignal)
			} else {
				if (
					route.kind === "service" &&
					!(await settleOnAbort(isSignedIn(route.settings), attemptSignal, "sign-in check"))
				) {
					continue
				}
				attemptSignal.throwIfAborted()
				raw = await settleOnAbort(
					singleCompletionHandler(route.settings, prompt, { abortSignal: attemptSignal, timeoutMs }),
					attemptSignal,
					"commit draft",
				)
			}
			signal.throwIfAborted()
			const message = raw && getCommitMessage(raw)
			if (message) return message
			log(`${label} returned no usable draft.`)
		} catch {
			signal.throwIfAborted()
			log(`${label} could not draft a commit message.`)
		}
	}
	return undefined
}
