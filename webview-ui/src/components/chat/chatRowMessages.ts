// Resolve older transcript links and prior to-do updates from chat messages.
// Extracted from ChatRow.tsx.

import type { ClineMessage, ClineSayTool, TodoItem } from "@roo-code/types"

import { safeJsonParse } from "@roo/core"
import type { useAppTranslation } from "@src/i18n/TranslationContext"

export type ChatRowTranslation = ReturnType<typeof useAppTranslation>["t"]

export type ChatRowTool = ClineSayTool & { todos?: TodoItem[] }

export function findPreviousTodoUpdate(messages: ClineMessage[], currentMessageTs: number): string | undefined {
	return messages.findLast((message) => {
		if (message.ts >= currentMessageTs || message.type !== "ask" || message.ask !== "tool" || !message.text) {
			return false
		}
		try {
			const tool: Pick<ClineSayTool, "tool"> | null = JSON.parse(message.text)
			return tool?.tool === "updateTodoList"
		} catch {
			return false
		}
	})?.text
}

function isNewTaskMessage(message: ClineMessage): boolean {
	return message.ask === "tool" && safeJsonParse<ClineSayTool>(message.text)?.tool === "newTask"
}

export function getLinkedChildTaskId(
	message: ClineMessage,
	messages: ClineMessage[],
	childIds: string[],
	completedByChildId?: string,
): string | undefined {
	if (message.childTaskId) return message.childTaskId

	const messageIndex = messages.findIndex((candidate) => candidate.ts === message.ts)
	if (messageIndex < 0) return undefined

	const precedingNewTasks = messages.slice(0, messageIndex + 1).filter(isNewTaskMessage)
	const newTask = precedingNewTasks.at(-1)
	if (newTask?.childTaskId) return newTask.childTaskId

	// Only subtask_result rows pass completedByChildId; it beats positional guesses after rejected legacy asks.
	if (
		completedByChildId &&
		!messages.slice(messageIndex + 1).some((candidate) => candidate.say === "subtask_result")
	) {
		return completedByChildId
	}

	const childTaskId = childIds[precedingNewTasks.length - 1]
	// Rejected asks must not borrow a child explicitly assigned to another approval.
	const isAssignedToAnotherAsk = messages.some(
		(candidate) => isNewTaskMessage(candidate) && candidate.childTaskId === childTaskId,
	)
	return isAssignedToAnotherAsk ? undefined : childTaskId
}
