/**
 * Text protocol that lets a subscription CLI request Zoo Code tools.
 *
 * The Muse Code and Antigravity CLIs cannot accept caller-defined function tools. Zoo Code
 * therefore switches off their built-in tools, describes its own tools in the prompt, and asks
 * the model to write each call as a tagged JSON object. This module parses those blocks out of
 * the streamed text so that Zoo Code can run the calls through its normal tool pipeline.
 */

export const TOOL_CALL_OPEN_TAG = "<zoo_tool_call>"
export const TOOL_CALL_CLOSE_TAG = "</zoo_tool_call>"

export interface ParsedToolCall {
	name: string
	/** JSON-encoded argument object. */
	arguments: string
}

export type ToolCallProtocolEvent = { type: "text"; text: string } | ({ type: "tool_call" } & ParsedToolCall)

/**
 * Returns the index after the JSON object that starts at `start`, or -1 when the object is not
 * complete yet. Braces inside JSON strings are ignored, so file contents that contain braces or
 * the protocol tags do not end the object early.
 */
export function findJsonObjectEnd(source: string, start: number): number {
	let depth = 0
	let inString = false
	let escaped = false

	for (let index = start; index < source.length; index++) {
		const char = source[index]

		if (inString) {
			if (escaped) {
				escaped = false
			} else if (char === "\\") {
				escaped = true
			} else if (char === '"') {
				inString = false
			}
			continue
		}

		if (char === '"') {
			inString = true
		} else if (char === "{") {
			depth++
		} else if (char === "}") {
			depth--
			if (depth === 0) {
				return index + 1
			}
		}
	}

	return -1
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Accepts `{ name, arguments }` and the common variants that models produce
 * (`input`/`parameters`/`args`, or arguments encoded as a JSON string).
 */
export function normalizeToolCallPayload(raw: unknown): ParsedToolCall | undefined {
	if (!isRecord(raw)) {
		return undefined
	}

	const name = raw.name ?? raw.tool ?? raw.tool_name
	if (typeof name !== "string" || name.trim() === "") {
		return undefined
	}

	let args: unknown = raw.arguments ?? raw.input ?? raw.parameters ?? raw.args ?? {}
	if (typeof args === "string") {
		try {
			args = args.trim() === "" ? {} : JSON.parse(args)
		} catch {
			return undefined
		}
	}

	if (!isRecord(args)) {
		return undefined
	}

	return { name: name.trim(), arguments: JSON.stringify(args) }
}

/** Length of the longest suffix of `text` that is a proper prefix of `tag`. */
function partialTagSuffixLength(text: string, tag: string): number {
	const max = Math.min(text.length, tag.length - 1)
	for (let length = max; length > 0; length--) {
		if (tag.startsWith(text.slice(text.length - length))) {
			return length
		}
	}
	return 0
}

// Text allowed between the open tag and the JSON object (whitespace and an optional code fence).
const BEFORE_JSON = /^\s*(?:```(?:json)?\s*)?$/
const JSON_FENCE = "```json"

/** True when more text could still turn `text` into an allowed prefix of the JSON object. */
function mayStillPrecedeJson(text: string): boolean {
	return BEFORE_JSON.test(text) || JSON_FENCE.startsWith(text.trimStart())
}
// Text allowed between the JSON object and the close tag.
const AFTER_JSON = /^\s*(?:```\s*)?/

/**
 * Incremental parser for streamed model text.
 *
 * Text is released as soon as it cannot be the start of a tool call block. A block is released
 * as one `tool_call` event when its JSON object is complete. A block that is not valid is
 * released as plain text so that nothing the model wrote is lost.
 */
export class ToolCallStreamParser {
	private buffer = ""
	private inToolCall = false

	push(delta: string): ToolCallProtocolEvent[] {
		this.buffer += delta
		return this.drain(false)
	}

	finish(): ToolCallProtocolEvent[] {
		return this.drain(true)
	}

	private drain(final: boolean): ToolCallProtocolEvent[] {
		const events: ToolCallProtocolEvent[] = []

		while (true) {
			if (!this.inToolCall) {
				const openIndex = this.buffer.indexOf(TOOL_CALL_OPEN_TAG)
				if (openIndex === -1) {
					const held = final ? 0 : partialTagSuffixLength(this.buffer, TOOL_CALL_OPEN_TAG)
					const text = this.buffer.slice(0, this.buffer.length - held)
					if (text) {
						events.push({ type: "text", text })
					}
					this.buffer = this.buffer.slice(this.buffer.length - held)
					return events
				}

				const text = this.buffer.slice(0, openIndex)
				if (text) {
					events.push({ type: "text", text })
				}
				this.buffer = this.buffer.slice(openIndex + TOOL_CALL_OPEN_TAG.length)
				this.inToolCall = true
				continue
			}

			const braceIndex = this.buffer.indexOf("{")
			if (braceIndex === -1 || !BEFORE_JSON.test(this.buffer.slice(0, braceIndex))) {
				if (!final && braceIndex === -1 && mayStillPrecedeJson(this.buffer)) {
					return events
				}
				return this.releaseAsText(events)
			}

			const jsonEnd = findJsonObjectEnd(this.buffer, braceIndex)
			if (jsonEnd === -1) {
				return final ? this.releaseAsText(events) : events
			}

			const rest = this.buffer.slice(jsonEnd)
			const separator = AFTER_JSON.exec(rest)?.[0] ?? ""
			const afterSeparator = rest.slice(separator.length)
			const closeMayFollow =
				(afterSeparator.length < TOOL_CALL_CLOSE_TAG.length &&
					TOOL_CALL_CLOSE_TAG.startsWith(afterSeparator)) ||
				(afterSeparator.length < 3 && "```".startsWith(afterSeparator))
			if (!final && closeMayFollow) {
				// The closing fence or close tag may still be on its way.
				return events
			}

			let call: ParsedToolCall | undefined
			try {
				call = normalizeToolCallPayload(JSON.parse(this.buffer.slice(braceIndex, jsonEnd)))
			} catch {
				call = undefined
			}
			if (!call) {
				return this.releaseAsText(events)
			}

			events.push({ type: "tool_call", ...call })
			const consumed = afterSeparator.startsWith(TOOL_CALL_CLOSE_TAG)
				? jsonEnd + separator.length + TOOL_CALL_CLOSE_TAG.length
				: jsonEnd
			this.buffer = this.buffer.slice(consumed)
			this.inToolCall = false
		}
	}

	private releaseAsText(events: ToolCallProtocolEvent[]): ToolCallProtocolEvent[] {
		events.push({ type: "text", text: TOOL_CALL_OPEN_TAG + this.buffer })
		this.buffer = ""
		this.inToolCall = false
		return events
	}
}
