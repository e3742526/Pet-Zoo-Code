import type { ClineMessage, TokenUsage } from "@roo-code/types"
import {
	type ParsedApiReqStartedTextType,
	consolidateTokenUsage as getApiMetrics,
	hasTokenUsageChanged,
	hasToolUsageChanged,
} from "@roo-code/core/browser"

import { combineApiRequests } from "./combineApiRequests"
import { combineCommandSequences } from "./combineCommandSequences"

export { type ParsedApiReqStartedTextType, getApiMetrics, hasTokenUsageChanged, hasToolUsageChanged }

/** Compute usage from raw transcript rows without rebuilding command and MCP output. */
export function getTaskMessageMetrics(messages: readonly ClineMessage[], startIndex = 0): TokenUsage {
	const accountingMessages: ClineMessage[] = []
	const toolTimestamps = new Set<number>()
	let hasLegacyFinish = false

	for (let i = startIndex; i < messages.length; i++) {
		const message = messages[i]
		if (!message) continue

		if (message.type === "ask" && (message.ask === "command" || message.ask === "use_mcp_server")) {
			toolTimestamps.add(message.ts)
		} else if (
			message.type === "say" &&
			message.ask !== "command_output" &&
			(message.say === "api_req_started" ||
				message.say === "api_req_finished" ||
				message.say === "condense_context")
		) {
			accountingMessages.push(message)
			hasLegacyFinish ||= message.say === "api_req_finished"
		}
	}

	// Older transcripts can share timestamps across rows. Tool consolidation can
	// replace an accounting row with a tool row in that case.
	if (toolTimestamps.size && accountingMessages.some((message) => toolTimestamps.has(message.ts))) {
		return getApiMetrics(combineApiRequests(combineCommandSequences(messages.slice(startIndex))))
	}

	return getApiMetrics(hasLegacyFinish ? combineApiRequests(accountingMessages) : accountingMessages)
}
