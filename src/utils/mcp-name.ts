/**
 * Utilities for sanitizing MCP server and tool names to conform to
 * API function name requirements across all providers.
 */

/**
 * Separator used between MCP prefix, server name, and tool name.
 * We use "--" (double hyphen) because:
 * 1. It's allowed by all providers (dashes are permitted in function names)
 * 2. It won't conflict with underscores in sanitized server/tool names
 * 3. It's unique enough to be a reliable delimiter for parsing
 */
export const MCP_TOOL_SEPARATOR = "--"

/**
 * Prefix for all MCP tool function names.
 */
export const MCP_TOOL_PREFIX = "mcp"

export const MAX_MCP_TOOL_NAME_LENGTH = 64

// A sanitized server name always starts with a letter or underscore.
const MCP_TOOL_ALIAS_PREFIX = `${MCP_TOOL_PREFIX}${MCP_TOOL_SEPARATOR}0${MCP_TOOL_SEPARATOR}`
const MCP_TOOL_ALIAS_UNDERSCORE_PREFIX = normalizeForComparison(MCP_TOOL_ALIAS_PREFIX)

export type McpServerToolNames = ReadonlyArray<{ name: string; tools?: ReadonlyArray<{ name: string }> }>

/**
 * Normalize a string for comparison by treating hyphens and underscores as equivalent.
 * This is used to match tool names when models convert hyphens to underscores.
 *
 * @param name - The name to normalize
 * @returns The normalized name with all hyphens converted to underscores
 */
export function normalizeForComparison(name: string): string {
	return name.replace(/-/g, "_")
}

/**
 * Normalize an MCP tool name by converting underscore separators back to hyphens.
 * This handles the case where models (especially Claude) convert hyphens to underscores
 * in tool names when using native tool calling.
 *
 * For example: "mcp__server__tool" -> "mcp--server--tool"
 *
 * This function uses fuzzy matching - it treats hyphens and underscores as equivalent
 * when normalizing the separator pattern.
 *
 * @param toolName - The tool name that may have underscore separators
 * @returns The normalized tool name with hyphen separators
 */
export function normalizeMcpToolName(toolName: string): string {
	// Normalize for comparison to detect MCP tools regardless of separator style
	const normalized = normalizeForComparison(toolName)

	// Only normalize if it looks like an MCP tool (starts with mcp__)
	if (normalized.startsWith("mcp__")) {
		// Find the pattern: mcp{sep}server{sep}tool where sep is -- or __
		// We need to convert the separators while preserving the rest

		// Prefer the canonical separator when present: a raw "--" can only be a
		// separator, while "__" may be part of a legal server or tool name
		const parts = toolName.includes(MCP_TOOL_SEPARATOR) ? toolName.split(MCP_TOOL_SEPARATOR) : toolName.split("__")

		if (parts.length >= 3 && parts[0].toLowerCase() === "mcp") {
			// Reconstruct with proper -- separators
			const serverName = parts[1]
			const toolNamePart = parts.slice(2).join("--") // Rejoin in case tool name had separator
			return `${MCP_TOOL_PREFIX}${MCP_TOOL_SEPARATOR}${serverName}${MCP_TOOL_SEPARATOR}${toolNamePart}`
		}
	}
	return toolName
}

/**
 * Check if a tool name is an MCP tool (starts with the MCP prefix and separator).
 * Uses fuzzy matching to handle both hyphen and underscore separators.
 *
 * @param toolName - The tool name to check
 * @returns true if the tool name starts with "mcp--" or "mcp__", false otherwise
 */
export function isMcpTool(toolName: string): boolean {
	const normalized = normalizeForComparison(toolName)
	return normalized.startsWith(`${MCP_TOOL_PREFIX}__`)
}

/**
 * Sanitize a name to be safe for use in API function names.
 * This removes special characters and ensures the name starts correctly.
 *
 * Note: Hyphens are preserved since they are valid in function names.
 * Models may convert hyphens to underscores, but we handle this with
 * fuzzy matching when parsing tool names.
 *
 * @param name - The original name (e.g., MCP server name or tool name)
 * @returns A sanitized name that conforms to API requirements
 */
export function sanitizeMcpName(name: string): string {
	if (!name) {
		return "_"
	}

	// Replace spaces with underscores first
	let sanitized = name.replace(/\s+/g, "_")

	// Only allow alphanumeric, underscores, and hyphens
	sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, "")

	// Replace any double-hyphen sequences with single hyphen to avoid separator conflicts
	sanitized = sanitized.replace(/--+/g, "-")

	// Ensure the name starts with a letter or underscore
	if (sanitized.length > 0 && !/^[a-zA-Z_]/.test(sanitized)) {
		sanitized = "_" + sanitized
	}

	// If empty after sanitization, use a placeholder
	if (!sanitized) {
		sanitized = "_unnamed"
	}

	return sanitized
}

function buildFullMcpToolName(server: string, tool: string): string {
	return `${MCP_TOOL_PREFIX}${MCP_TOOL_SEPARATOR}${server}${MCP_TOOL_SEPARATOR}${tool}`
}

function fitMcpToolName(fullName: string, tool: string): string {
	if (fullName.length <= MAX_MCP_TOOL_NAME_LENGTH) {
		return fullName
	}
	const suffix = `_${createHash("sha256").update(fullName).digest("hex").slice(0, 16)}`
	const hintLength = MAX_MCP_TOOL_NAME_LENGTH - MCP_TOOL_ALIAS_PREFIX.length - suffix.length
	return `${MCP_TOOL_ALIAS_PREFIX}${tool.slice(0, hintLength)}${suffix}`
}

/** Builds the provider function name, with a stable alias for long names. */
export function buildMcpToolName(serverName: string, toolName: string): string {
	const tool = sanitizeMcpName(toolName)
	return fitMcpToolName(buildFullMcpToolName(sanitizeMcpName(serverName), tool), tool)
}

export function isMcpToolAlias(name: string): boolean {
	return name.startsWith(MCP_TOOL_ALIAS_PREFIX) || name.startsWith(MCP_TOOL_ALIAS_UNDERSCORE_PREFIX)
}

/** Resolves provider function names to catalog entries. Ambiguous matches have no target. */
export function resolveMcpToolByName(
	servers: McpServerToolNames,
	calledName: string,
	includeLegacyTruncation = false,
): { serverName: string; toolName: string; name: string } | undefined {
	const comparableName = normalizeForComparison(calledName)
	let bestRank = 0
	let bestMatch: { serverName: string; toolName: string; name: string } | undefined
	for (const server of servers) {
		const sanitizedServer = sanitizeMcpName(server.name)
		for (const tool of server.tools ?? []) {
			const sanitizedTool = sanitizeMcpName(tool.name)
			const fullName = buildFullMcpToolName(sanitizedServer, sanitizedTool)
			const name = fitMcpToolName(fullName, sanitizedTool)
			let rank = 0
			if (calledName === name || calledName === fullName) {
				rank = 3
			} else if (
				comparableName === normalizeForComparison(name) ||
				comparableName === normalizeForComparison(fullName)
			) {
				rank = 2
			} else if (
				includeLegacyTruncation &&
				calledName.length === MAX_MCP_TOOL_NAME_LENGTH &&
				fullName.length > MAX_MCP_TOOL_NAME_LENGTH &&
				comparableName === normalizeForComparison(fullName.slice(0, MAX_MCP_TOOL_NAME_LENGTH))
			) {
				rank = 1
			}
			if (rank > bestRank) {
				bestRank = rank
				bestMatch = { serverName: server.name, toolName: tool.name, name }
			} else if (rank > 0 && rank === bestRank) {
				bestMatch = undefined
			}
		}
	}
	return bestMatch
}

/**
 * Parse an MCP tool function name back into server and tool names.
 * This handles both hyphen and underscore separators using fuzzy matching.
 *
 * @param mcpToolName - The full MCP tool name (e.g., "mcp--weather--get_forecast" or "mcp__weather__get_forecast")
 * @returns An object with serverName and toolName, or null if parsing fails
 */
export function parseMcpToolName(mcpToolName: string): { serverName: string; toolName: string } | null {
	// Normalize the name to handle both separator styles
	const normalizedName = normalizeMcpToolName(mcpToolName)

	const prefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR
	if (!normalizedName.startsWith(prefix)) {
		return null
	}

	// Remove the "mcp--" prefix
	const remainder = normalizedName.slice(prefix.length)

	// Split on the separator to get server and tool names
	const separatorIndex = remainder.indexOf(MCP_TOOL_SEPARATOR)
	if (separatorIndex === -1) {
		return null
	}

	const serverName = remainder.slice(0, separatorIndex)
	const toolName = remainder.slice(separatorIndex + MCP_TOOL_SEPARATOR.length)

	if (!serverName || !toolName) {
		return null
	}

	return {
		serverName,
		toolName,
	}
}

/**
 * Check if two tool names match using fuzzy comparison.
 * Treats hyphens and underscores as equivalent.
 *
 * @param name1 - First tool name
 * @param name2 - Second tool name
 * @returns true if the names match (treating - and _ as equivalent)
 */
export function toolNamesMatch(name1: string, name2: string): boolean {
	return normalizeForComparison(name1) === normalizeForComparison(name2)
}
import { createHash } from "node:crypto"
