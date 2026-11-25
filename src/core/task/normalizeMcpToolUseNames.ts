import type { Anthropic } from "@anthropic-ai/sdk"
import {
	buildMcpToolName,
	isMcpTool,
	isMcpToolAlias,
	MAX_MCP_TOOL_NAME_LENGTH,
	parseMcpToolName,
	resolveMcpToolByName,
	type McpServerToolNames,
} from "../../utils/mcp-name"

/** True for alias names and for names at or over the limit that an older version truncated. */
function needsNormalization(name: string): boolean {
	return isMcpToolAlias(name) || (name.length >= MAX_MCP_TOOL_NAME_LENGTH && isMcpTool(name))
}

/**
 * Maps a saved MCP tool name to the name the current build sends.
 * Order: catalog match, name already within the limit, rebuilt alias, hard truncation.
 */
export function getMcpToolNameForHistory(name: string, getServers: () => McpServerToolNames): string {
	if (!needsNormalization(name)) {
		return name
	}
	const resolved = resolveMcpToolByName(getServers(), name, true)
	if (resolved) {
		return resolved.name
	}
	if (name.length <= MAX_MCP_TOOL_NAME_LENGTH) {
		return name
	}
	const parts = parseMcpToolName(name)
	return parts ? buildMcpToolName(parts.serverName, parts.toolName) : name.slice(0, MAX_MCP_TOOL_NAME_LENGTH)
}

/** Repairs old tool names in the request copy and keeps each call and result ID. */
export function normalizeMcpToolUseNames<Message extends Anthropic.Messages.MessageParam>(
	messages: Message[],
	getServers: () => McpServerToolNames,
): Message[] {
	// Read the server catalog at most once per call, and only if a name needs repair.
	let servers: McpServerToolNames | undefined
	const getServerSnapshot = () => (servers ??= getServers())
	// Cache repaired names so repeated calls to one tool resolve once.
	const names = new Map<string, string>()
	// Copy-on-write: return the input array untouched when nothing needs repair.
	let normalized: Message[] | undefined
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index]
		if (
			message.role !== "assistant" ||
			!Array.isArray(message.content) ||
			!message.content.some((block) => block.type === "tool_use" && needsNormalization(block.name))
		) {
			continue
		}
		normalized ??= messages.slice()
		normalized[index] = {
			...message,
			content: message.content.map((block) => {
				if (block.type !== "tool_use" || !needsNormalization(block.name)) {
					return block
				}
				let name = names.get(block.name)
				if (name === undefined) {
					name = getMcpToolNameForHistory(block.name, getServerSnapshot)
					names.set(block.name, name)
				}
				return name === block.name ? block : { ...block, name }
			}),
		}
	}
	return normalized ?? messages
}
