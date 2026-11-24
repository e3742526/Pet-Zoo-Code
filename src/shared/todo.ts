import type { ClineMessage, TodoItem } from "@roo-code/types"

const nonTodoTexts = new WeakMap<ClineMessage, string>()

export function getLatestTodo(clineMessages: readonly ClineMessage[]): TodoItem[] {
	for (let index = clineMessages.length - 1; index >= 0; index--) {
		const message = clineMessages[index]
		if (!message?.text) continue
		const { type, ask, say, text } = message
		if (!(type === "ask" && ask === "tool") && !(type === "say" && say === "user_edit_todos")) continue

		// Streaming keeps earlier tool rows. Inspect an unrelated payload again only if its text changes.
		if (nonTodoTexts.get(message) === text) continue
		try {
			const payload: { tool?: string; todos?: TodoItem[] } | null = JSON.parse(text)
			if (payload?.tool === "updateTodoList" && Array.isArray(payload.todos)) return payload.todos
		} catch {
			// An incomplete or malformed payload is not a todo update.
		}
		nonTodoTexts.set(message, text)
	}

	return []
}
