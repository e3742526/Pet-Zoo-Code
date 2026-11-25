// Buffer possible leaked tool markup until a stream segment ends.
// Extracted from vscode-lm.ts.

import type { ApiStreamChunk } from "../transform/stream"
import {
	extractLeakedToolCallsWithState,
	LEAKED_TOOL_CALL_START,
	QuotingScanState,
	trailingPartialToolMarkerLength,
	type LeakedToolSchemas,
} from "./vscode-lm-leaked-tools"

export class LeakedToolSalvage {
	private salvageBuffer: string[] | undefined
	private salvageCarry = ""
	private salvageCarryIsInvokeWhitespace = false
	private salvagePrecedingText: string[] = []
	private readonly salvageScan = new QuotingScanState()
	private salvagedToolCallIndex = 0

	constructor(
		private readonly providedToolSchemas: LeakedToolSchemas,
		private readonly encodedToolAliases: ReadonlyMap<string, string | undefined>,
	) {}

	*push(text: string): IterableIterator<ApiStreamChunk> {
		if (this.salvageBuffer) {
			this.salvageBuffer.push(text)
			return
		}

		// An unfinished invoke can carry unlimited whitespace; do not rescan it for every chunk.
		if (this.salvageCarryIsInvokeWhitespace && /^\s*$/.test(text)) {
			this.salvageCarry += text
			return
		}
		this.salvageCarryIsInvokeWhitespace = false

		// Watch for the start of a leaked tool-call block, carrying a small tail across
		// chunks so a marker split across chunk boundaries is still detected.
		const combined = this.salvageCarry + text
		const markerMatch = combined.match(LEAKED_TOOL_CALL_START)
		if (markerMatch) {
			const before = combined.slice(0, markerMatch.index)
			if (before) {
				this.salvagePrecedingText.push(before)
				yield { type: "text", text: before }
			}
			this.salvageBuffer = [combined.slice(markerMatch.index)]
			this.salvageCarry = ""
		} else {
			const carryLength = trailingPartialToolMarkerLength(combined)
			const emit = carryLength > 0 ? combined.slice(0, combined.length - carryLength) : combined
			this.salvageCarry = carryLength > 0 ? combined.slice(combined.length - carryLength) : ""
			this.salvageCarryIsInvokeWhitespace = /^<(?:antml:)?invoke\s+$/i.test(this.salvageCarry)
			if (emit) {
				this.salvagePrecedingText.push(emit)
				yield { type: "text", text: emit }
			}
		}
	}

	private parseSalvage(span: string): ApiStreamChunk[] {
		const drained: ApiStreamChunk[] = []
		const { calls, leftoverText } = extractLeakedToolCallsWithState(
			span,
			this.providedToolSchemas,
			this.salvageScan,
		)
		if (leftoverText) {
			drained.push({ type: "text", text: leftoverText })
		}
		for (const call of calls) {
			const originalName = this.encodedToolAliases.get(call.name) ?? call.name
			console.warn(
				"Zoo Code <Language Model API>: Recovered a tool call the model emitted as text instead of a structured tool call:",
				{ name: originalName, params: Object.keys(call.input) },
			)
			drained.push({
				type: "tool_call",
				id: `vscodelm-salvaged-${Date.now()}-${this.salvagedToolCallIndex++}`,
				name: originalName,
				arguments: JSON.stringify(call.input),
			})
		}
		return drained
	}

	// Only EOF or a native call ends a text segment: even closed invokes cannot settle global
	// wrapper stripping or text-before-call ordering while more text may arrive. No size cap is safe.
	// Native boundaries finalize markup, but retain quote/wrapper state outside completed bodies.
	flush(): ApiStreamChunk[] {
		if (this.providedToolSchemas.size === 0) {
			return []
		}

		this.salvageScan.advance(this.salvagePrecedingText.join(""))
		this.salvagePrecedingText = []
		if (!this.salvageBuffer) {
			const carried = this.salvageCarry
			this.salvageCarry = ""
			this.salvageCarryIsInvokeWhitespace = false
			this.salvageScan.advance(carried)
			return carried ? [{ type: "text", text: carried }] : []
		}

		const buffered = this.salvageBuffer.join("")
		this.salvageBuffer = undefined
		return this.parseSalvage(buffered)
	}
}
