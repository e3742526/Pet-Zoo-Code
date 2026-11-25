// Budget conversation text while preserving tool-call pairs. Test helpers remain available from vscode-lm.ts.
// Extracted from vscode-lm.ts.

import type { Anthropic } from "@anthropic-ai/sdk"

import { CONTEXT_WINDOW_EXCEEDED_STATUS } from "../../core/context/context-management/context-error-handling"

/**
 * Context-window safety for Copilot's backend
 * -------------------------------------------
 * Copilot's backend enforces its own context window and, for third-party `sendRequest` callers,
 * trims an over-window request in a way that is NOT tool-pair-aware: it can drop the assistant
 * message holding a `tool_use` while keeping the matching `tool_result`, after which Anthropic
 * rejects the request with "unexpected tool_use_id". To keep trimming on OUR side — where
 * pairing is preserved — we shrink oversized `tool_result` payloads before sending. Only
 * `tool_result` text is truncated (never `tool_use`, assistant text, summaries, or environment
 * details), and only when the request would otherwise exceed the budget.
 */

// Text trimming uses 3 chars/token rather than ~4 for token-dense code and logs.
// Native image input is counted separately by the host before sending; this budget is text-only.
const VSCODE_LM_BUDGET_CHARS_PER_TOKEN = 3

/**
 * Fraction of the context window the *entire* input (system prompt + tool schemas + conversation)
 * is allowed to occupy. The remaining headroom absorbs char/token estimation variance and any
 * output/overhead the backend reserves.
 */
const VSCODE_LM_INPUT_BUDGET_FRACTION = 0.8

/** A tool_result is never shrunk below this many characters, so a truncated result stays useful. */
const MIN_TOOL_RESULT_CHARS = 2000

/** Approximate placeholder length; the text-only budget does not measure native image tokens. */
const IMAGE_PLACEHOLDER_CHARS = 64

function readToolResultText(block: Anthropic.Messages.ContentBlockParam): string | undefined {
	if (!block || (block as { type?: string }).type !== "tool_result") {
		return undefined
	}
	const content = (block as Anthropic.Messages.ToolResultBlockParam).content
	if (typeof content === "string") {
		return content
	}
	if (Array.isArray(content)) {
		return content
			.filter((part): part is Anthropic.Messages.TextBlockParam => (part as { type?: string })?.type === "text")
			.map((part) => part.text ?? "")
			.join("")
	}
	return undefined
}

function writeToolResultText(block: Anthropic.Messages.ContentBlockParam, text: string): void {
	const toolResult = block as Anthropic.Messages.ToolResultBlockParam
	const content = toolResult.content
	if (Array.isArray(content)) {
		// Preserve any non-text parts (e.g. images) and collapse the text into one truncated part.
		const nonText = content.filter((part) => (part as { type?: string })?.type !== "text")
		toolResult.content = [{ type: "text", text }, ...nonText] as typeof content
		return
	}
	toolResult.content = text
}

/**
 * Drops a trailing lone high surrogate, whose low half was cut away. A lone surrogate cannot be
 * encoded as UTF-8, and the backend 400s the whole request when one is present.
 */
function trimTrailingHighSurrogate(text: string): string {
	return text.length > 0 && (text.charCodeAt(text.length - 1) & 0xfc00) === 0xd800 ? text.slice(0, -1) : text
}

/**
 * Middle-out truncate `text` to at most `maxChars`, keeping the head and tail and replacing the
 * middle with a marker noting how many characters were removed. Head/tail are preserved because
 * logs and file dumps carry the most signal at their start (structure) and end (recent output).
 */
export function middleOutTruncate(text: string, maxChars: number): string {
	if (maxChars <= 0) {
		return ""
	}
	if (text.length <= maxChars) {
		return text
	}

	const buildMarker = (removed: number) =>
		`\n\n[... ${removed.toLocaleString("en-US")} characters truncated to fit the model context window ...]\n\n`

	// Reserve room for the marker, sized against the original length so the result never grows.
	const reservedMarkerLength = buildMarker(text.length).length
	// A budget too small to hold the marker cannot describe its own truncation without breaking the
	// maxChars promise this function makes to callers, so drop the marker and keep a bare head.
	if (maxChars <= reservedMarkerLength) {
		return trimTrailingHighSurrogate(text.slice(0, maxChars))
	}
	const keep = maxChars - reservedMarkerLength
	const headLength = Math.ceil(keep / 2)
	const tailLength = keep - headLength
	const head = trimTrailingHighSurrogate(text.slice(0, headLength))
	let tail = tailLength > 0 ? text.slice(text.length - tailLength) : ""
	// Likewise, don't start the tail on a lone low surrogate (its high half is in the removed middle).
	if (tail.length > 0 && (tail.charCodeAt(0) & 0xfc00) === 0xdc00) {
		tail = tail.slice(1)
	}
	const removed = text.length - head.length - tail.length
	return `${head}${buildMarker(removed)}${tail}`
}

/**
 * Estimated character cost of a whole conversation, using the same accounting as truncation.
 *
 * @internal Exported for focused implementation tests.
 */
export function estimateMessagesChars(messages: Anthropic.Messages.MessageParam[]): number {
	return messages.reduce((sum, message) => sum + estimateContentChars(message.content), 0)
}

function estimateContentChars(content: Anthropic.Messages.MessageParam["content"]): number {
	if (typeof content === "string") {
		return content.length
	}
	if (!Array.isArray(content)) {
		return 0
	}
	let total = 0
	for (const block of content) {
		const type = (block as { type?: string })?.type
		if (type === "text") {
			total += (block as Anthropic.Messages.TextBlockParam).text?.length ?? 0
		} else if (type === "tool_result") {
			total += readToolResultText(block)?.length ?? 0
		} else if (type === "tool_use") {
			total += JSON.stringify((block as Anthropic.Messages.ToolUseBlockParam).input ?? {}).length
		} else if (type === "image") {
			total += IMAGE_PLACEHOLDER_CHARS
		}
	}
	return total
}

/**
 * Shrinks oversized `tool_result` payloads (largest first, middle-out) until the conversation fits
 * `budgetChars`. Mutates the tool_result blocks of the supplied messages in place — callers pass a
 * cloned array (see `createMessage`) so stored history is never mutated. A no-op when the
 * conversation already fits. `remainingChars` is the post-truncation cost, equal to
 * `estimateMessagesChars(messages)`, so callers need not re-scan.
 */
export function truncateToolResultsToFitWindow(
	messages: Anthropic.Messages.MessageParam[],
	budgetChars: number,
): { messages: Anthropic.Messages.MessageParam[]; remainingChars: number } {
	const initialTotal = () => messages.reduce((sum, message) => sum + estimateContentChars(message.content), 0)
	if (!Number.isFinite(budgetChars) || budgetChars <= 0) {
		return { messages, remainingChars: initialTotal() }
	}

	let total = initialTotal()
	if (total <= budgetChars) {
		return { messages, remainingChars: total }
	}

	// Collect every truncatable tool_result block, largest first. The text is derived once per
	// block here because the comparator and the truncation loop below would otherwise re-derive it.
	const blockText = new Map<Anthropic.Messages.ContentBlockParam, string>()
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue
		}
		for (const block of message.content) {
			const text = readToolResultText(block)
			if (text !== undefined) {
				blockText.set(block, text)
			}
		}
	}
	const toolResultBlocks = [...blockText.keys()]
	toolResultBlocks.sort((a, b) => (blockText.get(b)?.length ?? 0) - (blockText.get(a)?.length ?? 0))

	for (const block of toolResultBlocks) {
		if (total <= budgetChars) {
			break
		}
		const text = blockText.get(block)
		if (text === undefined || text.length <= MIN_TOOL_RESULT_CHARS) {
			continue
		}

		const overage = total - budgetChars
		const target = Math.max(MIN_TOOL_RESULT_CHARS, text.length - overage)

		const truncated = middleOutTruncate(text, target)
		total -= text.length - truncated.length
		writeToolResultText(block, truncated)
	}

	return { messages, remainingChars: total }
}

export function enforceConversationBudget(
	messages: Anthropic.Messages.MessageParam[],
	contextWindowTokens: number,
	systemPrompt: string,
	tools?: unknown[],
): void {
	if (Number.isFinite(contextWindowTokens) && contextWindowTokens > 0) {
		const toolSchemaChars = tools ? JSON.stringify(tools).length : 0
		const rawBudgetChars =
			contextWindowTokens * VSCODE_LM_INPUT_BUDGET_FRACTION * VSCODE_LM_BUDGET_CHARS_PER_TOKEN -
			systemPrompt.length -
			toolSchemaChars
		// A system prompt or tool schema large enough to consume the whole budget would leave a
		// non-positive budget, which disables trimming exactly when the request is most oversized.
		const messagesBudgetChars = Math.max(MIN_TOOL_RESULT_CHARS, rawBudgetChars)
		const { remainingChars } = truncateToolResultsToFitWindow(messages, messagesBudgetChars)

		// Shrinking tool_results cannot always reach the budget: each keeps MIN_TOOL_RESULT_CHARS,
		// and the excess may be non-tool content (a huge paste, tool_use inputs, or the system
		// prompt) that we must not touch. Dropping messages here would orphan a tool_result from
		// its tool_use — the exact 400 this guard exists to prevent — so fail loudly instead of
		// sending a request we already know is over the window.
		// Admission is judged against the RAW budget, not the clamped one: the clamp exists only
		// to keep trimming productive, so accepting up to it would send a request the window
		// genuinely cannot hold whenever the raw budget falls below MIN_TOOL_RESULT_CHARS.
		if (remainingChars > rawBudgetChars) {
			// `status` is what makes checkContextWindowExceededError recognise this as a context
			// -window failure; without it the task takes its generic retry path and re-sends the
			// same over-window history instead of condensing.
			throw Object.assign(
				new Error(
					"Zoo Code <Language Model API>: The request is too large for this model's context window " +
						`(estimated ${remainingChars.toLocaleString("en-US")} characters against a budget of ` +
						`${Math.max(0, Math.floor(rawBudgetChars)).toLocaleString("en-US")}), and it cannot be reduced further without ` +
						"breaking tool-call pairing. Condense the conversation or start a new task.",
				),
				{ status: CONTEXT_WINDOW_EXCEEDED_STATUS },
			)
		}
	}
}
