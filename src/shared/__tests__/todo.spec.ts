import type { ClineMessage, TodoItem } from "@roo-code/types"

import { getLatestTodo } from "../todo"

const earlier: TodoItem = { id: "earlier", content: "Plan the work", status: "completed" }
const latest: TodoItem = { id: "latest", content: "Check the results", status: "pending" }

function todoUpdate(ts: number, todos: TodoItem[]): ClineMessage {
	const text = JSON.stringify({ tool: "updateTodoList", todos })
	return { type: "ask", ask: "tool", ts, text }
}

it("uses the latest valid user edit before earlier todo updates", () => {
	const first = todoUpdate(1, [earlier])
	const userEdit: ClineMessage = { ...todoUpdate(2, [latest]), type: "say", say: "user_edit_todos", ask: undefined }
	const malformed: ClineMessage = { type: "ask", ask: "tool", ts: 3, text: "{incomplete" }
	const parse = vi.spyOn(JSON, "parse")
	try {
		expect(getLatestTodo([first, userEdit, malformed])).toEqual([latest])
		expect(parse).not.toHaveBeenCalledWith(first.text)
	} finally {
		parse.mockRestore()
	}
})

it("keeps the newest empty list instead of using an earlier todo update", () => {
	expect(getLatestTodo([todoUpdate(1, [earlier]), todoUpdate(2, [])])).toEqual([])
})

it("skips unchanged tool payloads and checks again when their text changes", () => {
	const read: ClineMessage = { type: "ask", ask: "tool", ts: 1, text: '{"tool":"readFile","path":"src/entry.ts"}' }
	const update = todoUpdate(1, [latest])
	const parse = vi.spyOn(JSON, "parse")
	try {
		expect(getLatestTodo([read])).toEqual([])
		expect(getLatestTodo([read])).toEqual([])
		expect(parse.mock.calls.filter(([input]) => input === read.text)).toHaveLength(1)

		read.text = update.text
		expect(getLatestTodo([read])).toEqual([latest])
	} finally {
		parse.mockRestore()
	}
})

it("returns separate todo items for each lookup", () => {
	const messages = [todoUpdate(1, [latest])]
	const result = getLatestTodo(messages)
	result[0].status = "in_progress"
	expect(getLatestTodo(messages)).toEqual([latest])
})
