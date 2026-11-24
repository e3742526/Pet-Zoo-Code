import type { CliTurnEvent } from "./base-handler"

/**
 * Reduces `agy --output-format stream-json` output to Zoo Code stream events.
 *
 * Qualified against agy 1.5.16. Event shapes:
 * - `{"event":"init","conversation_id":...,"init":{model,cwd,tools,permission_mode}}`
 * - `{"event":"step_update","step_update":{step_index,state,step_type,text_delta?,usage?,tool_name?}}`
 *   `agent_response` steps stream the answer in `text_delta`. `tool` steps are built-in tool runs.
 * - `{"event":"result","result":{status,response,usage}}` once at the end of the turn.
 *
 * Usage is reported per step and again as a total in `result`. Only the `result` total is used,
 * so tokens are not counted twice. Antigravity's `input_tokens` excludes `cache_read_tokens`.
 */

export interface AntigravityResult {
	status: string
	response: string
	error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function stringify(value: unknown): string {
	if (typeof value === "string") return value
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

export class AntigravityEventReducer {
	private resultValue: AntigravityResult | undefined
	private streamedText = false
	private errorMessages: string[] = []
	conversationId: string | undefined
	/** Names of built-in tools the CLI ran (should stay empty under the read-only settings). */
	readonly builtInToolsUsed: string[] = []

	get result(): AntigravityResult | undefined {
		return this.resultValue
	}

	get errors(): string {
		return this.errorMessages.join("\n")
	}

	get succeeded(): boolean {
		return this.resultValue?.status === "SUCCESS"
	}

	consume(event: unknown): CliTurnEvent[] {
		if (!isRecord(event) || typeof event.event !== "string") {
			return []
		}

		switch (event.event) {
			case "init":
				if (typeof event.conversation_id === "string") this.conversationId = event.conversation_id
				return []
			case "step_update":
				return this.consumeStep(event.step_update)
			case "result":
				return this.consumeResult(event.result)
			case "error":
				this.errorMessages.push(stringify(event.error ?? event.message ?? event))
				return []
			default:
				return []
		}
	}

	private consumeStep(step: unknown): CliTurnEvent[] {
		if (!isRecord(step) || this.resultValue) return []

		if (step.step_type === "tool" && typeof step.tool_name === "string" && step.state === "ACTIVE") {
			this.builtInToolsUsed.push(step.tool_name)
		}

		const events: CliTurnEvent[] = []
		if (typeof step.thinking_delta === "string" && step.thinking_delta) {
			events.push({ type: "reasoning", text: step.thinking_delta })
		}
		if (step.step_type === "agent_response" && typeof step.text_delta === "string" && step.text_delta) {
			this.streamedText = true
			events.push({ type: "text", text: step.text_delta })
		}
		return events
	}

	private consumeResult(result: unknown): CliTurnEvent[] {
		if (!isRecord(result) || this.resultValue) return []

		this.resultValue = {
			status: typeof result.status === "string" ? result.status : "UNKNOWN",
			response: typeof result.response === "string" ? result.response : "",
			error: result.error !== undefined ? stringify(result.error) : undefined,
		}

		const events: CliTurnEvent[] = []
		if (this.succeeded && !this.streamedText && this.resultValue.response) {
			this.streamedText = true
			events.push({ type: "text", text: this.resultValue.response })
		}

		if (isRecord(result.usage)) {
			const uncachedInput = numberOrZero(result.usage.input_tokens)
			const cacheReadTokens = numberOrZero(result.usage.cache_read_tokens)
			const reasoningTokens = numberOrZero(result.usage.thinking_tokens)
			events.push({
				type: "usage",
				// Zoo Code expects OpenAI-style input totals that include cached tokens.
				inputTokens: uncachedInput + cacheReadTokens,
				outputTokens: numberOrZero(result.usage.output_tokens),
				cacheReadTokens: cacheReadTokens || undefined,
				reasoningTokens: reasoningTokens || undefined,
				// Billed to the Antigravity subscription, not per token.
				totalCost: 0,
			})
		}
		return events
	}
}

/** Extracts the `short_error` from an `AGY_ERROR: {...}` line on stderr, when present. */
export function parseAntigravityStderrError(stderr: string): string | undefined {
	const match = /AGY_ERROR:\s*(\{.*\})/.exec(stderr)
	if (!match) return undefined
	try {
		const parsed: unknown = JSON.parse(match[1])
		if (isRecord(parsed)) {
			const message = parsed.short_error ?? parsed.message ?? parsed.error
			return typeof message === "string" ? message : stringify(message)
		}
	} catch {
		// Not JSON; the raw stderr is still shown as a diagnostic.
	}
	return undefined
}
