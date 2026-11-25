import { Anthropic } from "@anthropic-ai/sdk"

/**
 * Set of content block types that are valid for Anthropic API.
 * Only these types will be passed through to the API.
 * See: https://docs.anthropic.com/en/api/messages
 */
export const VALID_ANTHROPIC_BLOCK_TYPES = new Set([
	"text",
	"image",
	"tool_use",
	"tool_result",
	"thinking",
	"redacted_thinking",
	"document",
])

/**
 * Filters out non-Anthropic content blocks from messages before sending to Anthropic/Vertex API.
 * Uses an allowlist approach - only blocks with types in VALID_ANTHROPIC_BLOCK_TYPES are kept.
 * This automatically filters out:
 * - Internal "reasoning" blocks (Roo Code's internal representation)
 * - Gemini's "thoughtSignature" blocks (encrypted reasoning continuity tokens)
 * - Any other unknown block types
 */
export function filterNonAnthropicBlocks(
	messages: Anthropic.Messages.MessageParam[],
): Anthropic.Messages.MessageParam[] {
	return messages
		.map((message) => {
			if (typeof message.content === "string") {
				return message
			}
			if (!Array.isArray(message.content)) {
				return undefined
			}

			const filteredContent = message.content.filter((block) => {
				const blockType = (block as { type: string }).type
				// Only keep block types that Anthropic recognizes
				return VALID_ANTHROPIC_BLOCK_TYPES.has(blockType)
			})

			// If all content was filtered out, return undefined to filter the message later
			if (filteredContent.length === 0) {
				return undefined
			}

			return {
				...message,
				content: filteredContent,
			}
		})
		.filter((message): message is Anthropic.Messages.MessageParam => message !== undefined)
}

/** Prepare a copy of the history for the Anthropic Messages API. */
export function prepareAnthropicMessages(
	messages: Anthropic.Messages.MessageParam[],
): Anthropic.Messages.MessageParam[] {
	const filtered = filterNonAnthropicBlocks(messages)
	const prepared: Anthropic.Messages.MessageParam[] = []
	const toolUseIds = new Set<string>()

	for (let index = 0; index < filtered.length;) {
		const message = filtered[index++]
		if (message.role === "assistant") {
			prepared.push(message)
			if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block.type === "tool_use") {
						toolUseIds.add(block.id)
					}
				}
			}
			continue
		}

		// Anthropic combines consecutive messages of the same role into a single turn.
		const userTurn = [message]
		while (filtered[index]?.role === "user") {
			userTurn.push(filtered[index++])
		}
		prepared.push(...repairUserTurn(userTurn, toolUseIds))
		toolUseIds.clear()
	}

	return prepared
}

function repairUserTurn(
	userTurn: Anthropic.Messages.MessageParam[],
	toolUseIds: ReadonlySet<string>,
): Anthropic.Messages.MessageParam[] {
	const results = new Map<string, Anthropic.Messages.ToolResultBlockParam>()
	let sawOtherContent = false
	let needsRepair = false

	for (const message of userTurn) {
		if (typeof message.content === "string") {
			sawOtherContent = true
			continue
		}
		for (const block of message.content) {
			if (block.type !== "tool_result") {
				sawOtherContent = true
				continue
			}
			if (!toolUseIds.has(block.tool_use_id) || results.has(block.tool_use_id)) {
				needsRepair = true
				continue
			}
			results.set(block.tool_use_id, block)
			needsRepair ||= sawOtherContent
		}
	}

	if (!needsRepair && results.size === toolUseIds.size) {
		return userTurn
	}

	const content: Anthropic.Messages.ContentBlockParam[] = []
	for (const id of toolUseIds) {
		content.push(
			results.get(id) ?? {
				type: "tool_result",
				tool_use_id: id,
				content: "No result was recorded for this tool call.",
				is_error: true,
			},
		)
	}
	for (const message of userTurn) {
		if (typeof message.content === "string") {
			if (message.content.length > 0) {
				content.push({ type: "text", text: message.content })
			}
		} else {
			content.push(...message.content.filter((block) => block.type !== "tool_result"))
		}
	}

	return content.length > 0 ? [{ role: "user", content }] : []
}
