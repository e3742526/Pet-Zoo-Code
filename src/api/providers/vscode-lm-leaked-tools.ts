// Recognize leaked tool markup outside quoted examples. Parser helpers remain available from vscode-lm.ts.
// Extracted from vscode-lm.ts.

import { parseLeakedInvokeParams } from "./vscode-lm-leaked-tool-parameters"

/**
 * Recovery for leaked tool calls
 * ------------------------------
 * Some VS Code LM backends — notably GitHub Copilot serving Anthropic Claude models —
 * intermittently stream a tool call as PLAIN TEXT using Anthropic's internal function-call
 * XML instead of emitting a structured `LanguageModelToolCallPart`. When this happens the
 * assistant turn contains no tool_use block, so Zoo reports "no tools used" and the task stalls
 * in a retry loop. The helpers below detect the leaked markup mid-stream and replay it as a real
 * tool call. Recovery is deliberately conservative: only `<invoke>` blocks whose name matches a
 * tool we actually offered this turn are treated as calls; everything else is passed through
 * unchanged as text.
 *
 * SCOPE: only the WRAPPED variant — an `<invoke>` inside an open `<function_calls>` wrapper — is
 * recovered. A bare, unwrapped `<invoke>` is deliberately left as text: we have no observation of
 * this backend emitting one, while quoted examples and prompt-injected file content routinely
 * contain bare markup, so passing it through is the safer default rather than a security boundary.
 * Widening to the bare case needs a reproduction first.
 */
// Latching on a bare `<invoke` would let any prose mentioning the tag stop real-time streaming for
// the rest of the response, so the marker only counts once the `name="` attribute has arrived.
export const LEAKED_TOOL_CALL_START = /<\/?(?:antml:)?function_calls(?:\s|>)|<(?:antml:)?invoke\s+name="/i

/** Bounds generic tag fragments, not prefixes that can still become valid recovery markup. */
const MAX_PARTIAL_INVOKE_CARRY = 64

/**
 * Left-to-right scan state behind the quoting heuristics: open code fence, current line start,
 * backticks seen on the current line, and whether a `<function_calls>` wrapper is open.
 *
 * State is threaded through the match loop and advanced only over newly consumed text. Rebuilding
 * each candidate's prefix and re-walking it was quadratic in message length on ordinary output.
 */
export class QuotingScanState {
	private openFence: { marker: string; width: number } | null = null
	private wrapperOpen = false
	/** Text of the line now being scanned, up to the point the scan has reached. */
	sameLineBefore = ""

	/** Consumes the next contiguous span of the stream. Spans must not overlap or skip text. */
	advance(span: string): void {
		const lines = span.split("\n")
		for (const [index, line] of lines.entries()) {
			const lineStart = this.sameLineBefore.length
			const fenceBeforeLine = this.openFence
			this.sameLineBefore += line
			// A wrapper opener shown as an example must not arm wrapped-only recovery for a later
			// bare invoke, so tags are read in source order and openers are ignored in quoted code.
			// A wrapper tag admits only whitespace before its `>`, so it never straddles a span
			// boundary, which always falls on the `<` of an `<invoke>` marker.
			for (const wrapperTag of line.matchAll(/<(\/?)(?:antml:)?function_calls\s*>/gi)) {
				const textBeforeTag = this.sameLineBefore.slice(0, lineStart + wrapperTag.index)
				if (this.insideInlineSpanAt(textBeforeTag)) {
					continue
				}
				// A closer can only ever suppress recovery, so honour it even inside a fence.
				if (wrapperTag[1] !== "") {
					this.wrapperOpen = false
				} else if (fenceBeforeLine === null && !/^ {0,3}(?:`{3,}|~{3,})/.test(this.sameLineBefore)) {
					this.wrapperOpen = true
				}
			}
			if (index < lines.length - 1) {
				this.openFence = this.fenceAfterCurrentLine()
				this.sameLineBefore = ""
			}
		}
	}

	/** True when the stream so far ends inside an open Markdown code fence. */
	isInsideCodeFence(): boolean {
		return this.fenceAfterCurrentLine() !== null
	}

	/** True when the stream so far ends inside an inline code span. */
	hasOddBacktickCountOnLine(): boolean {
		return this.insideInlineSpanAt(this.sameLineBefore)
	}

	/** CommonMark: a code span closes only on a backtick run of the SAME width that opened it. */
	private insideInlineSpanAt(prefix: string): boolean {
		let activeWidth = 0
		for (const run of prefix.matchAll(/`+/g)) {
			const width = run[0].length
			if (activeWidth === 0) {
				activeWidth = width
			} else if (width === activeWidth) {
				activeWidth = 0
			}
		}
		return activeWidth !== 0
	}

	isInsideFunctionCallsWrapper(): boolean {
		return this.wrapperOpen
	}

	/** Fence state including the partial line now being scanned, which may itself open a fence. */
	private fenceAfterCurrentLine(): { marker: string; width: number } | null {
		// The scanned line never contains a newline, so the run's suffix is simply the rest of it.
		const fenceMatch = this.sameLineBefore.match(/^ {0,3}(`{3,}|~{3,})/)
		if (!fenceMatch) {
			return this.openFence
		}
		const marker = fenceMatch[1][0]
		const width = fenceMatch[1].length
		const suffix = this.sameLineBefore.slice(fenceMatch[0].length)
		if (!this.openFence) {
			// CommonMark: a backtick opening fence's info string may not contain a backtick.
			return marker === "`" && suffix.includes("`") ? null : { marker, width }
		}
		// CommonMark allows an info string only on an opening fence, never a closing one.
		const closesFence = marker === this.openFence.marker && width >= this.openFence.width && suffix.trim() === ""
		return closesFence ? null : this.openFence
	}
}

/**
 * Strips well-formed tags, including nested ones. Removing a tag can reassemble a live-looking tag
 * from the characters around it (`<<invoke>>`), so tags are matched with a single-pass stack rather
 * than by re-replacing until the text stops changing.
 */
function stripTagsCompletely(text: string): string {
	let output = ""
	// Bodies of `<` runs still awaiting a `>`; an unterminated one is never a tag, so it is emitted verbatim.
	const pendingTags: string[] = []
	for (let iter = 0; iter < text.length; iter += 1) {
		const character = text[iter]
		if (character === "<") {
			pendingTags.push("")
		} else if (character === ">" && pendingTags.length > 0) {
			pendingTags.pop()
		} else if (pendingTags.length > 0) {
			pendingTags[pendingTags.length - 1] += character
		} else {
			output += character
		}
	}
	for (const pending of pendingTags) {
		output += `<${pending}`
	}
	return output
}

/**
 * Returns the length of a trailing fragment that might be the start of a leaked tool-call marker
 * split across stream chunks. Such a tail is held back until more text arrives so the marker can
 * be detected intact.
 */
export function trailingPartialToolMarkerLength(text: string): number {
	const tailStart = text.lastIndexOf("<")
	const tail = text.slice(tailStart).toLowerCase()
	if (
		tailStart !== -1 &&
		[
			"<function_calls",
			"</function_calls",
			"<antml:function_calls",
			"</antml:function_calls",
			"<invoke",
			"<antml:invoke",
		].some((marker) => marker.startsWith(tail))
	) {
		return tail.length
	}
	// Whitespace in a valid unfinished opener has no length limit in the whole-input parser.
	if (/<(?:antml:)?invoke\s+(?:n(?:a(?:m(?:e(?:=)?)?)?)?)?$/i.test(text)) {
		return text.length - tailStart
	}
	const partialTag = text.match(/<(?:antml:)?[a-zA-Z_]*$/)
	if (partialTag) {
		return partialTag[0].length <= MAX_PARTIAL_INVOKE_CARRY ? partialTag[0].length : 0
	}
	// Non-matching invoke fragments remain bounded so ordinary prose can resume streaming.
	const partialInvoke = text.match(/<(?:antml:)?invoke\b[^<>]*$/i)
	return partialInvoke && partialInvoke[0].length <= MAX_PARTIAL_INVOKE_CARRY ? partialInvoke[0].length : 0
}

/**
 * Words that mark nearby markup as being talked about rather than invoked.
 */
const QUOTING_CUE_PATTERN =
	/\b(?:never|not|do not|don't|does not|doesn't|must not|mustn't|avoid|instead of|rather than|for example|e\.g\.|such as|like this|as follows)\b/gi

/**
 * True when a quoting cue falls in the unterminated final sentence of `sameLineBefore`. Pairing the
 * cue with a terminator-free tail in one pattern re-scanned that tail once per cue.
 */
function hasQuotingCue(sameLineBefore: string): boolean {
	const lastTerminator = Math.max(
		sameLineBefore.lastIndexOf("."),
		sameLineBefore.lastIndexOf("!"),
		sameLineBefore.lastIndexOf("?"),
	)
	for (const cue of sameLineBefore.matchAll(QUOTING_CUE_PATTERN)) {
		if (cue.index + cue[0].length > lastTerminator) {
			return true
		}
	}
	return false
}

/**
 * True when the block ending at `endIndex` is being quoted — inside a fenced code block, inside an
 * inline code span, or embedded mid-sentence in plain prose — rather than invoked.
 *
 * `scan` must already be advanced to the start of the block.
 */
function isQuotedAsCode(text: string, endIndex: number, scan: QuotingScanState): boolean {
	if (scan.isInsideCodeFence() || scan.hasOddBacktickCountOnLine()) {
		return true
	}
	// Narrative words after the block on the same line mean the markup is being talked about
	// (e.g. "never emit <invoke ...> directly"), which must not be replayed as a live call.
	const lineEnd = text.indexOf("\n", endIndex)
	const restOfLine = text.slice(endIndex, lineEnd === -1 ? undefined : lineEnd)
	if (stripTagsCompletely(restOfLine).trim().length > 0) {
		return true
	}
	// A quoted invoke that ENDS its line leaves no trailing text to judge, and a real leak is
	// commonly narrated too — keying off leading prose alone regressed genuine recoveries, so only
	// this narrow cue suppresses it.
	return hasQuotingCue(stripTagsCompletely(scan.sameLineBefore))
}

/**
 * JSON Schema (draft 2020-12 subset) for one tool's parameters, keyed by tool name. Supplied by
 * `createMessage` from the very schemas offered to the model, so recovery converts a leaked
 * parameter to the type the tool actually declares.
 */
export type LeakedToolSchemas = ReadonlyMap<string, Record<string, unknown> | undefined>

/**
 * Extracts complete leaked `<invoke>` tool-call blocks from `text`. Only blocks whose name
 * is present in `validTools` are returned as calls; all other text (including `<invoke>`
 * blocks for unknown names) is returned as `leftoverText` so legitimate prose is preserved.
 *
 * `validTools` may be a bare name set (no schemas, so every parameter stays a literal string) or a
 * map from tool name to its parameter schema, which enables typed conversion.
 *
 * @internal Exported for focused implementation tests.
 */
export function extractLeakedToolCalls(
	text: string,
	validTools: ReadonlySet<string> | LeakedToolSchemas,
	precedingText = "",
): { calls: Array<{ name: string; input: Record<string, unknown> }>; leftoverText: string } {
	const scan = new QuotingScanState()
	scan.advance(precedingText)
	return extractLeakedToolCallsWithState(text, validTools, scan)
}

export function extractLeakedToolCallsWithState(
	text: string,
	validTools: ReadonlySet<string> | LeakedToolSchemas,
	scan: QuotingScanState,
): { calls: Array<{ name: string; input: Record<string, unknown> }>; leftoverText: string } {
	const schemaFor = (name: string) =>
		validTools instanceof Map ? (validTools.get(name) as Record<string, unknown> | undefined) : undefined
	const calls: Array<{ name: string; input: Record<string, unknown> }> = []
	// Text outside recovered blocks, in stream order.
	let leftover = ""
	let lastIndex = 0

	let scannedUpTo = 0

	const openPattern = /<(?:antml:)?invoke\s+name="([^"]+)"\s*>/gi
	const closePattern = /<\/(?:antml:)?invoke\s*>/gi
	for (let open = openPattern.exec(text); open !== null; open = openPattern.exec(text)) {
		const bodyStart = open.index + open[0].length
		closePattern.lastIndex = bodyStart
		const close = closePattern.exec(text)
		// With no closing tag after this open there is none after any later open either.
		if (!close) {
			break
		}
		const blockEnd = close.index + close[0].length
		leftover += text.slice(lastIndex, open.index)
		const name = open[1]
		scan.advance(text.slice(scannedUpTo, open.index))
		// Only text outside invoke bodies may move parser state, otherwise markup quoted in one
		// block could open a wrapper or fence that changes the verdict on a later block.
		scannedUpTo = blockEnd
		const recoverable =
			validTools.has(name) && scan.isInsideFunctionCallsWrapper() && !isQuotedAsCode(text, blockEnd, scan)
		// Parsing may still fail closed when a parameter doesn't match its declared type.
		const input = recoverable
			? parseLeakedInvokeParams(text.slice(bodyStart, close.index), schemaFor(name))
			: undefined
		if (input) {
			calls.push({ name, input })
		} else {
			// Not one of our tools, quoted as code, or un-convertible — keep the block as literal text.
			leftover += text.slice(open.index, blockEnd)
		}
		lastIndex = blockEnd
		openPattern.lastIndex = blockEnd
	}
	leftover += text.slice(lastIndex)
	scan.advance(text.slice(scannedUpTo))

	// Once a call is recovered its `<function_calls>` wrapper is spent markup, so drop every wrapper
	// tag (cosmetic; also avoids re-teaching the model this format when the turn replays as history).
	// With nothing recovered the same tags are user-visible prose and must survive verbatim.
	if (calls.length > 0) {
		leftover = leftover.replace(/<\/?(?:antml:)?function_calls\s*>/gi, "")
	}

	return { calls, leftoverText: leftover }
}
