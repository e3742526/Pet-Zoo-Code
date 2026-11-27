import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { z } from "zod"
import type { SDKUserMessage, Options } from "@anthropic-ai/claude-agent-sdk/core"

import {
	closeNativeProcess,
	fingerprint,
	installedRuntime,
	nativeEnvironment,
	NativeDisconnectedError,
	NativeShutdownError,
	runtimeStatus,
	spawnNative,
} from "./process"
import type { AgentRoute, NativeOutput, NativeRuntime } from "./runtime"
import { deferred } from "./deferred"

const VERSION = "2.1.284"
const SDK_VERSION = "0.3.284"
const statusSchema = z.object({
	loggedIn: z.boolean(),
	authMethod: z.string(),
	apiProvider: z.string(),
	email: z.string().nullish(),
	orgId: z.string().nullish(),
})
const questionsSchema = z
	.array(
		z.object({
			question: z.string().min(1).max(1000),
			options: z.array(z.object({ label: z.string().max(150), description: z.string().max(500) })).max(6),
			multiSelect: z.boolean().optional(),
		}),
	)
	.min(1)
	.max(5)
const imagePattern = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/

export function supportedClaudeImage(image: string): boolean {
	return imagePattern.test(image)
}

function imageBlock(image: string): {
	type: "image"
	source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string }
} {
	const match = imagePattern.exec(image)
	if (!match) throw new Error("Use a PNG, JPEG, GIF, or WebP image.")
	const mediaType = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]).parse(match[1])
	return { type: "image", source: { type: "base64", media_type: mediaType, data: match[2] } }
}

export async function openClaude(route: AgentRoute, nativeId?: string): Promise<NativeRuntime> {
	const executable = await installedRuntime("claude", VERSION)
	const env = nativeEnvironment()
	env.ANTHROPIC_BASE_URL = "https://api.anthropic.com"
	env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
	env.DISABLE_TELEMETRY = "1"
	if (route.apiKey) env.ANTHROPIC_API_KEY = route.apiKey

	let accountScope: string
	if (route.route === "api-key" && route.apiKey) {
		accountScope = fingerprint(route.profileId, route.apiKey)
	} else {
		const status = statusSchema.safeParse(
			await runtimeStatus(executable, ["auth", "status", "--json"], route.cwd, env),
		)
		if (
			!status.success ||
			!status.data.loggedIn ||
			status.data.authMethod !== "claude.ai" ||
			status.data.apiProvider !== "firstParty" ||
			!status.data.email ||
			!status.data.orgId
		) {
			throw new Error("Sign in to Claude Code with your Claude account on this host.")
		}
		accountScope = fingerprint(status.data.email.toLowerCase(), status.data.orgId)
	}

	const id = nativeId ?? randomUUID()
	const input = deferred<SDKUserMessage | undefined>()
	const endInput = deferred<void>()
	const controller = new AbortController()
	const children = new Set<ChildProcessWithoutNullStreams>()
	const commandsInProgress = new Set<string>()
	let startedBackgroundCommand = false
	let output: NativeOutput | undefined
	let closed: Promise<void> | undefined
	let stopping = false
	const canUseTool: NonNullable<Options["canUseTool"]> = async (tool, parameters, { signal }) => {
		const deny = { behavior: "deny", message: "Dory did not approve this operation." } as const
		if (!output || signal.aborted || stopping) return deny
		if (tool === "AskUserQuestion") {
			const questions = questionsSchema.safeParse(parameters.questions)
			if (
				!questions.success ||
				new Set(questions.data.map((entry) => entry.question)).size !== questions.data.length
			)
				return deny
			const answers = await output.question(questions.data)
			if (!answers || signal.aborted || stopping) return deny
			return { behavior: "allow", updatedInput: { ...parameters, answers } }
		}
		const detail =
			typeof parameters.command === "string"
				? parameters.command
				: typeof parameters.file_path === "string"
					? parameters.file_path
					: "One use of this tool"
		return (await output.approval(tool, detail)) && !signal.aborted && !stopping
			? { behavior: "allow", updatedInput: parameters }
			: deny
	}

	async function* messages() {
		const entry = await input.promise
		if (entry) {
			yield entry
			await endInput.promise
		}
	}

	const { query } = await import("@anthropic-ai/claude-agent-sdk/core")
	const stream = query({
		prompt: messages(),
		options: {
			cwd: route.cwd,
			pathToClaudeCodeExecutable: executable,
			env,
			model: route.model,
			...(nativeId ? { resume: nativeId } : { sessionId: id }),
			abortController: controller,
			systemPrompt: { type: "preset", preset: "claude_code" },
			settingSources: ["project"],
			settings: { disableAllHooks: true },
			strictMcpConfig: true,
			mcpServers: {},
			permissionMode: "default",
			allowDangerouslySkipPermissions: false,
			disallowedTools: ["EnterPlanMode", "ExitPlanMode", "Agent", "Task"],
			includePartialMessages: true,
			persistSession: true,
			canUseTool,
			spawnClaudeCodeProcess(options) {
				const child = spawnNative(options.command, options.args, options.cwd ?? route.cwd, options.env)
				children.add(child)
				child.stderr.resume()
				options.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true })
				return child
			},
		},
	})
	function close() {
		closed ??= (async () => {
			stopping = true
			input.resolve(undefined)
			endInput.resolve()
			stream.close()
			controller.abort()
			await Promise.all([...children].map(closeNativeProcess))
			if (commandsInProgress.size || startedBackgroundCommand) {
				throw new NativeShutdownError("Claude Code exited with unverified command activity.")
			}
		})()
		return closed
	}

	try {
		const init = await Promise.race([
			stream.initializationResult(),
			delay(10_000, undefined, { ref: false }).then(() => {
				throw new Error("The Claude Agent runtime did not initialize.")
			}),
		])
		const account = init.account
		if (
			account.apiProvider !== "firstParty" ||
			(route.route === "api-key"
				? account.apiKeySource !== "ANTHROPIC_API_KEY"
				: !account.email || (account.apiKeySource !== undefined && account.apiKeySource !== "none"))
		) {
			throw new Error("Claude Code reported a different authentication or billing route.")
		}
		if (route.route === "subscription") {
			const status = statusSchema.safeParse(
				await runtimeStatus(executable, ["auth", "status", "--json"], route.cwd, env),
			)
			if (
				!status.success ||
				!status.data.email ||
				!status.data.orgId ||
				account.email?.toLowerCase() !== status.data.email.toLowerCase() ||
				accountScope !== fingerprint(status.data.email.toLowerCase(), status.data.orgId)
			) {
				throw new Error("The Claude Code account changed during setup.")
			}
		}
		if (!init.models.some((model) => model.resolvedModel === route.model || model.value === route.model)) {
			throw new Error("Claude Code does not list this model. Select a model available in Claude Code.")
		}
		return {
			identity: { accountScope, version: `${VERSION} / SDK ${SDK_VERSION}`, images: true },
			async run(expectedId, text, images, sink, bind) {
				if (expectedId !== nativeId) throw new Error("The Claude session changed.")
				if (stopping) return "interrupted"
				output = sink
				await bind(id)
				if (stopping) return "interrupted"
				const content: Exclude<SDKUserMessage["message"]["content"], string> = [
					...(text ? [{ type: "text" as const, text }] : []),
					...images.map(imageBlock),
				]
				input.resolve({
					type: "user",
					session_id: id,
					parent_tool_use_id: null,
					message: { role: "user", content },
				})
				let partialId: string | undefined
				let messageNumber = 0
				let confirmed = false
				try {
					for await (const event of stream) {
						if (stopping) return "interrupted"
						if (event.session_id !== id) throw new Error("Claude Code returned a different session ID.")
						if (event.type === "system" && event.subtype === "init") {
							if (
								event.cwd !== route.cwd ||
								event.claude_code_version !== VERSION ||
								event.permissionMode !== "default" ||
								event.model !== route.model ||
								event.apiKeySource !== (route.route === "api-key" ? "ANTHROPIC_API_KEY" : "none")
							) {
								throw new Error(
									"Claude Code returned a different model, workspace, or execution configuration.",
								)
							}
							if (!confirmed) {
								confirmed = true
								await sink.started()
							}
						} else if (!confirmed) {
							if (event.type === "result") throw new Error("Claude Code could not start the turn.")
						} else if (event.type === "stream_event" && !event.parent_tool_use_id) {
							if (event.event.type === "message_start") partialId = `${id}-${++messageNumber}`
							if (
								event.event.type === "content_block_delta" &&
								event.event.delta.type === "text_delta" &&
								partialId
							) {
								sink.row({ id: partialId, kind: "assistant", text: event.event.delta.text }, true)
							}
						} else if (event.type === "user" && Array.isArray(event.message.content)) {
							for (const block of event.message.content) {
								if (block.type === "tool_result") commandsInProgress.delete(block.tool_use_id)
							}
						} else if (event.type === "assistant" && !event.parent_tool_use_id) {
							if (event.error)
								throw new Error(`Claude Code reported ${event.error.replaceAll("_", " ")}.`)
							const visible: string[] = []
							for (const block of event.message.content) {
								if (block.type === "text") visible.push(block.text)
								if (block.type === "tool_use") {
									if (block.name === "Bash") {
										commandsInProgress.add(block.id)
										if (
											z.object({ run_in_background: z.literal(true) }).safeParse(block.input)
												.success
										) {
											startedBackgroundCommand = true
										}
									}
									const args = z
										.object({ command: z.string().optional(), file_path: z.string().optional() })
										.safeParse(block.input)
									const detail = args.success ? (args.data.command ?? args.data.file_path) : undefined
									sink.row({
										id: block.id,
										kind: "action",
										text: [block.name, detail].filter(Boolean).join(" · "),
									})
								}
							}
							if (visible.length > 0)
								sink.row({ id: partialId ?? event.uuid, kind: "assistant", text: visible.join("\n") })
							partialId = undefined
						} else if (event.type === "result") {
							sink.usage(event.usage.input_tokens, event.usage.output_tokens)
							if (event.subtype === "success" && !event.is_error) return "completed"
							throw new Error(`Claude Agent ended this turn with ${event.subtype.replaceAll("_", " ")}.`)
						}
					}
				} catch (error) {
					if (stopping) return "interrupted"
					throw error
				}
				if (stopping) return "interrupted"
				throw new NativeDisconnectedError("Claude Code disconnected before reporting the turn result.")
			},
			async stop() {
				stopping = true
				await Promise.race([stream.interrupt().catch(() => {}), delay(2000, undefined, { ref: false })])
				await close()
			},
			close,
		}
	} catch (error) {
		await close()
		throw error
	}
}
