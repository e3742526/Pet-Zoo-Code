import {
	ANTIGRAVITY_DEFAULT_EXECUTABLE,
	antigravityDefaultModelId,
	antigravityDefaultModelInfo,
	antigravityModels,
	providerIdentifiers,
	type ModelInfo,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { getModelParams } from "../transform/model-params"

import { AntigravityEventReducer, parseAntigravityStderrError } from "./cli-subscription/antigravity-events"
import { CliSubscriptionHandler, type CliTurnEvent, type CliTurnRequest } from "./cli-subscription/base-handler"
import { formatCliFailure, type CliFailureCommands } from "./cli-subscription/errors"
import { resolveCliExecutable } from "./cli-subscription/executable"
import { runJsonlProcess } from "./cli-subscription/process"

const LABEL = "Antigravity"

const COMMANDS: CliFailureCommands = {
	login: "agy",
	listModels: "agy models",
}

/**
 * Settings for this session only (never saved). `request-review` makes the headless CLI refuse
 * every tool action that needs approval. This overrides an `always-proceed` value in the user's
 * own Antigravity settings.
 */
const SESSION_SETTINGS = JSON.stringify({ toolPermission: "request-review" })

/**
 * Flags that turn `agy` into a model backend for one Zoo Code turn.
 *
 * Verified with agy 1.5.16: plan mode plus `request-review` permission did not run commands or
 * write workspace files even when the model was told to; slash commands in the prompt are not
 * expanded. The prompt goes through stdin as one stream-json message, so its size is not limited
 * by the command line.
 */
export const ANTIGRAVITY_RESTRICTION_FLAGS = [
	"--mode",
	"plan",
	"--settings",
	SESSION_SETTINGS,
	"--disable-slash-commands",
] as const

export class AntigravityHandler extends CliSubscriptionHandler {
	protected readonly providerId = providerIdentifiers.antigravity

	constructor(private readonly options: ApiHandlerOptions) {
		super()
	}

	override getModel() {
		const id = this.options.apiModelId || antigravityDefaultModelId
		const info: ModelInfo = Object.hasOwn(antigravityModels, id)
			? antigravityModels[id as keyof typeof antigravityModels]
			: antigravityDefaultModelInfo
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})
		return { id, info, ...params }
	}

	/** Builds the `agy` arguments for one turn. The model ID already contains the effort level. */
	buildArgs(): string[] {
		return [
			"--input-format",
			"stream-json",
			"--output-format",
			"stream-json",
			"--model",
			this.getModel().id,
			...ANTIGRAVITY_RESTRICTION_FLAGS,
		]
	}

	protected async *runTurn(request: CliTurnRequest): AsyncGenerator<CliTurnEvent> {
		const executable = await resolveCliExecutable(
			this.options.antigravityExecutablePath,
			ANTIGRAVITY_DEFAULT_EXECUTABLE,
			LABEL,
		)

		const reducer = new AntigravityEventReducer()
		for await (const item of runJsonlProcess({
			executable,
			args: this.buildArgs(),
			cwd: request.workingDirectory,
			stdin: JSON.stringify({ event: "user", message: { content: request.prompt } }) + "\n",
			signal: request.signal,
			inactivityTimeoutMs: this.timeoutMs,
			label: LABEL,
		})) {
			if (item.type === "event") {
				yield* reducer.consume(item.value)
				continue
			}

			if (reducer.succeeded) {
				return
			}

			const result = reducer.result
			const stderrError = parseAntigravityStderrError(item.stderr)
			const summary = result
				? `the turn ended with status "${result.status}"${result.error ? `: ${result.error}` : ""}.`
				: stderrError
					? `${stderrError}.`
					: `the CLI exited (code ${item.exitCode ?? "none"}${item.signal ? `, signal ${item.signal}` : ""}) without a result.`
			const diagnostic = [reducer.errors, result?.response, item.stderr, ...item.nonJsonLines]
				.filter(Boolean)
				.join("\n")
			throw new Error(formatCliFailure(LABEL, summary, diagnostic, COMMANDS))
		}
	}
}
