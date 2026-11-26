import type { ClineMessage, HistoryItem } from "@roo-code/types"

import { findLastIndex } from "../../shared/array"
import { sanitizeToolUseId } from "../../utils/tool-id"
import { readApiMessages, saveApiMessages, type ApiMessage } from "./apiMessages"
import { readTaskMessages, saveTaskMessages } from "./taskMessages"

/**
 * Publish an accepted completion while the caller holds the parent history
 * file lock. The completed child is the durable intent for replay.
 */
export async function publishDelegationResult(
	globalStoragePath: string,
	parent: HistoryItem,
	childId: string,
	summary: string,
): Promise<{ ui: ClineMessage[]; api: ApiMessage[] }> {
	const storage = { taskId: parent.id, globalStoragePath }
	const [ui, api] = await Promise.all([readTaskMessages(storage), readApiMessages(storage)])
	const messageId = `delegation-result:${childId}`
	const ts = Math.max(Date.now(), (ui.at(-1)?.ts ?? 0) + 1, (api.at(-1)?.ts ?? 0) + 1)
	const text = `Subtask ${childId} completed.\n\nResult:\n${summary}`
	const hasUiResult = ui.some(
		(message) =>
			message.messageId === messageId ||
			(message.say === "subtask_result" && message.childTaskId === childId && message.text === summary),
	)
	const savedUi = hasUiResult
		? ui
		: await saveTaskMessages({
				...storage,
				merge: true,
				messages: [
					...ui,
					{ messageId, ts, type: "say", say: "subtask_result", text: summary, childTaskId: childId },
				],
			})

	// A new handoff records the exact tool call. Older records can still deliver
	// a text result when the original tool call cannot be identified safely.
	const toolId = parent.awaitedToolUseId
	const assistantIndex = toolId
		? findLastIndex(
				api,
				(message) =>
					message.role === "assistant" &&
					Array.isArray(message.content) &&
					message.content.some(
						(block) =>
							block.type === "tool_use" &&
							block.name === "new_task" &&
							sanitizeToolUseId(block.id) === toolId,
					),
			)
		: -1
	const answer = assistantIndex >= 0 ? api[assistantIndex + 1] : undefined
	const existingResult =
		answer?.role === "user" && Array.isArray(answer.content)
			? answer.content.find((block) => block.type === "tool_result" && block.tool_use_id === toolId)
			: undefined

	if (existingResult?.type === "tool_result" && answer) {
		if (existingResult.content === text && answer.delegationResultToolUseId === toolId) return { ui: savedUi, api }
		existingResult.content = text
		delete existingResult.is_error
		answer.delegationResultToolUseId = toolId
	} else {
		if (api.some((message) => message.messageId === messageId)) return { ui: savedUi, api }
		api.push({
			messageId,
			ts,
			role: "user",
			content:
				toolId && assistantIndex >= 0 && assistantIndex === api.length - 1
					? [{ type: "tool_result", tool_use_id: toolId, content: text }]
					: [{ type: "text", text }],
		})
	}

	return { ui: savedUi, api: await saveApiMessages({ ...storage, merge: true, messages: api }) }
}
