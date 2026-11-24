import type { CliTurnEvent } from "./base-handler"

/**
 * Reduces `muse exec --json` output (MSP event envelopes, one per line) to Zoo Code stream events.
 *
 * Qualified against Muse Code 1.4.25. Relevant payload types:
 * - `run.lifecycle.started`: the root run starts; its run stream ID identifies the root run.
 * - `run.output.delta`: streamed answer text (`payload.text`).
 * - `run.usage`: per-model token counts and the subscription allowance.
 * - `run.terminal.<state>`: exactly one terminal result (`terminal`, `text`, `reason`).
 *
 * Events from other run streams (for example subagents) are ignored, and a repeated terminal
 * event is ignored, so the answer and the usage are counted once.
 */

export interface MuseAllowanceWindow {
	usedPercent?: number
	resetsAtMs?: number
}

export interface MuseAllowance {
	window?: MuseAllowanceWindow
	weekly?: MuseAllowanceWindow
}

export interface MuseTerminal {
	terminal: string
	text: string
	reason?: string
}

/** The run stopped because the model tried a built-in tool and reached the step cap. */
const STEP_CAP_REASON = /did not reach a terminal state within \d+ step/i

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function parseAllowanceWindow(value: unknown): MuseAllowanceWindow | undefined {
	if (!isRecord(value)) return undefined
	return {
		usedPercent: typeof value.used_percent === "number" ? value.used_percent : undefined,
		resetsAtMs: typeof value.resets_at_ms === "number" ? value.resets_at_ms : undefined,
	}
}

export class MuseEventReducer {
	private rootRunId: string | undefined
	private terminalResult: MuseTerminal | undefined
	private streamedText = false
	private errorMessages: string[] = []
	allowance: MuseAllowance | undefined

	get terminal(): MuseTerminal | undefined {
		return this.terminalResult
	}

	/** Diagnostic text from error events, for failure messages. */
	get errors(): string {
		return this.errorMessages.join("\n")
	}

	/**
	 * True when the run ended at the step cap because the model tried a built-in tool. Zoo Code
	 * treats this as a reply without a tool call, which makes the task ask the model to use one.
	 */
	get endedAtStepCap(): boolean {
		return this.terminalResult?.terminal === "failed" && STEP_CAP_REASON.test(this.terminalResult.reason ?? "")
	}

	get succeeded(): boolean {
		return this.terminalResult?.terminal === "completed"
	}

	consume(envelope: unknown): CliTurnEvent[] {
		if (!isRecord(envelope) || typeof envelope.payload_type !== "string" || !isRecord(envelope.payload)) {
			return []
		}
		const type = envelope.payload_type
		const payload = envelope.payload
		const runId =
			isRecord(payload.run_stream) && typeof payload.run_stream.id === "string"
				? payload.run_stream.id
				: undefined

		if (type === "run.lifecycle.started") {
			this.rootRunId ??= runId
			return []
		}

		// Ignore output that belongs to another run (for example a subagent run).
		if (this.rootRunId && runId && runId !== this.rootRunId) {
			return []
		}

		if (type === "run.output.delta") {
			if (this.terminalResult || typeof payload.text !== "string" || payload.text === "") return []
			this.streamedText = true
			return [{ type: "text", text: payload.text }]
		}

		if (type === "run.usage") {
			return this.consumeUsage(payload)
		}

		if (type.startsWith("run.terminal.")) {
			if (this.terminalResult) return []
			this.terminalResult = {
				terminal: typeof payload.terminal === "string" ? payload.terminal : type.slice("run.terminal.".length),
				text: typeof payload.text === "string" ? payload.text : "",
				reason: typeof payload.reason === "string" ? payload.reason : undefined,
			}
			// Use the terminal text only when no deltas arrived, so the answer is not shown twice.
			if (this.terminalResult.terminal === "completed" && !this.streamedText && this.terminalResult.text) {
				this.streamedText = true
				return [{ type: "text", text: this.terminalResult.text }]
			}
			return []
		}

		if (type.includes("error") && typeof payload.message === "string") {
			this.errorMessages.push(payload.message)
		}
		return []
	}

	private consumeUsage(payload: Record<string, unknown>): CliTurnEvent[] {
		if (isRecord(payload.allowance)) {
			this.allowance = {
				window: parseAllowanceWindow(payload.allowance.window),
				weekly: parseAllowanceWindow(payload.allowance.weekly),
			}
		}

		const models = Array.isArray(payload.models) ? payload.models.filter(isRecord) : []
		let inputTokens = 0
		let outputTokens = 0
		let cacheReadTokens = 0
		let reasoningTokens = 0
		for (const model of models) {
			inputTokens += numberOrZero(model.input_tokens)
			outputTokens += numberOrZero(model.output_tokens)
			cacheReadTokens += numberOrZero(model.cached_tokens)
			reasoningTokens += numberOrZero(model.reasoning_tokens)
		}
		if (models.length === 0) return []

		return [
			{
				type: "usage",
				// Muse reports OpenAI-style counts: input tokens include cached tokens.
				inputTokens,
				outputTokens,
				cacheReadTokens: cacheReadTokens || undefined,
				reasoningTokens: reasoningTokens || undefined,
				// Billed to the Muse Code subscription, not per token.
				totalCost: 0,
			},
		]
	}
}
