import { promises as fs } from "fs"
import * as path from "path"

import {
	MUSE_CODE_DEFAULT_EXECUTABLE,
	museCodeDefaultModelId,
	museCodeDefaultModelInfo,
	museCodeModels,
	providerIdentifiers,
	type ModelInfo,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { getModelParams } from "../transform/model-params"

import { CliSubscriptionHandler, type CliTurnEvent, type CliTurnRequest } from "./cli-subscription/base-handler"
import { BUILT_IN_TOOL_CORRECTION } from "./cli-subscription/prompt"
import { formatCliFailure, ProviderQuotaExhaustedError, type CliFailureCommands } from "./cli-subscription/errors"
import { resolveCliExecutable } from "./cli-subscription/executable"
import { MuseEventReducer } from "./cli-subscription/muse-events"
import { runJsonlProcess } from "./cli-subscription/process"

const LABEL = "Muse Code"

const COMMANDS: CliFailureCommands = {
	login: "muse login",
	listModels: "muse exec --list-models",
	usage: "muse usage",
}

/**
 * Flags that turn `muse exec` into a model backend for one Zoo Code turn.
 *
 * Verified with Muse Code 1.4.25: the `empty` preset has the smallest built-in prompt (about 7,500
 * fewer input tokens per turn than the default); shell and file writes are refused even when the
 * model is told to use them; reminder agents and the approval judge make no extra model calls; one
 * model step means that a call to a remaining read-only built-in tool (read_file, search) ends
 * the run instead of continuing it; no session log is written.
 */
export const MUSE_RESTRICTION_FLAGS = [
	"--preset",
	"empty",
	"--disable-shell",
	"--disable-write",
	"--disable-web-tools",
	"--disable-request-user-input",
	"--disable-reminders",
	"--no-foreign-personal-context",
	"--approval-mode",
	"untrusted",
	"--approval-judge",
	"off",
	"--max-model-steps",
	"1",
	"--no-session-log",
] as const

const MAX_BUILT_IN_TOOL_RETRIES = 1
const SUBSCRIPTION_QUOTA_REASON =
	/^(?:API error 429(?: \[request_id=[^\]\r\n]+\])?: )?Subscription (?:quota exhausted|limit reached)\b/i

export class MuseCodeHandler extends CliSubscriptionHandler {
	protected readonly providerId = providerIdentifiers.museCode

	constructor(private readonly options: ApiHandlerOptions) {
		super()
	}

	protected override get deferToolCallsUntilTurnEnds(): boolean {
		return (
			!!this.options.museCodeQuotaFallbackProfileId &&
			this.options.museCodeQuotaFallbackAfterPartialReply === true
		)
	}

	override getModel() {
		const id = this.options.apiModelId || museCodeDefaultModelId
		const info: ModelInfo = Object.hasOwn(museCodeModels, id)
			? museCodeModels[id as keyof typeof museCodeModels]
			: museCodeDefaultModelInfo
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})
		return { id, info, ...params }
	}

	/** Builds the `muse exec` arguments for one turn. */
	buildArgs(promptFile: string): string[] {
		const { id, reasoningEffort } = this.getModel()
		const args = ["exec", "--json", "--model", id, "--prompt-file", promptFile, ...MUSE_RESTRICTION_FLAGS]
		if (reasoningEffort) {
			args.push("--reasoning-effort", reasoningEffort)
		}
		return args
	}

	protected async *runTurn(request: CliTurnRequest): AsyncGenerator<CliTurnEvent> {
		const executable = await resolveCliExecutable(
			this.options.museCodeExecutablePath,
			MUSE_CODE_DEFAULT_EXECUTABLE,
			LABEL,
		)

		// Muse cannot switch off its read-only built-in tools, and some share names with Zoo Code
		// tools. When the model calls one, the run stops at the step cap without output. One retry
		// with a direct correction fixes this in practice; a second miss is left to the task, which
		// then asks the model to use a tool.
		for (let attempt = 0; attempt <= MAX_BUILT_IN_TOOL_RETRIES; attempt++) {
			const prompt = attempt === 0 ? request.prompt : `${request.prompt}\n\n${BUILT_IN_TOOL_CORRECTION}`
			let producedOutput = false
			const reducer = new MuseEventReducer()
			for await (const event of this.runOnce(executable, prompt, request, reducer)) {
				if (event.type !== "usage") producedOutput = true
				yield event
			}
			if (!reducer.endedAtStepCap || producedOutput) {
				return
			}
		}
	}

	private async *runOnce(
		executable: string,
		prompt: string,
		request: CliTurnRequest,
		reducer: MuseEventReducer,
	): AsyncGenerator<CliTurnEvent> {
		// The prompt goes through a private file: it can be far larger than a command line allows.
		const promptFile = path.join(request.scratchDirectory, "prompt.md")
		await fs.writeFile(promptFile, prompt, { encoding: "utf8", mode: 0o600 })

		for await (const item of runJsonlProcess({
			executable,
			args: this.buildArgs(promptFile),
			cwd: request.workingDirectory,
			signal: request.signal,
			inactivityTimeoutMs: this.timeoutMs,
			label: LABEL,
		})) {
			if (item.type === "event") {
				yield* reducer.consume(item.value)
				continue
			}

			if (reducer.succeeded || reducer.endedAtStepCap) {
				return
			}

			const terminal = reducer.terminal
			const summary = terminal
				? `the run ended with status "${terminal.terminal}"${terminal.reason ? `: ${terminal.reason}` : ""}.`
				: `the CLI exited (code ${item.exitCode ?? "none"}${item.signal ? `, signal ${item.signal}` : ""}) without a result.`
			const diagnostic = [reducer.errors, item.stderr, ...item.nonJsonLines].filter(Boolean).join("\n")
			const message = formatCliFailure(LABEL, summary, diagnostic, COMMANDS)
			// Use the CLI's terminal reason. Stderr and non-JSON output can echo prompt text.
			if (terminal?.terminal === "failed" && SUBSCRIPTION_QUOTA_REASON.test(terminal.reason ?? "")) {
				throw new ProviderQuotaExhaustedError(message)
			}
			throw new Error(message)
		}
	}
}
