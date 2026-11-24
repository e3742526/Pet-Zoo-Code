import { act, screen } from "@testing-library/react"
import type { ClineMessage, HistoryItem, TodoStatus } from "@roo-code/types"

import { useExtensionState } from "@/context/ExtensionStateContext"
import { renderWithExtensionState } from "@/utils/test-utils"

import ChatRow from "../ChatRow"

const noop = () => {}
const { translate } = vi.hoisted(() => ({ translate: vi.fn((key: string) => key) }))

vi.mock("@/i18n/TranslationContext", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/i18n/TranslationContext")>()),
	useAppTranslation: () => ({ t: translate, language: "en" }),
}))

vi.mock("@/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

function Rows() {
	const { clineMessages } = useExtensionState()
	return clineMessages.map((message, index) => {
		const isLast = index === clineMessages.length - 1
		return (
			<ChatRow
				key={message.ts}
				message={message}
				isLast={isLast}
				isStreaming
				lastModifiedMessage={isLast ? message : undefined}
				isExpanded={false}
				onToggleExpand={noop}
				onHeightChange={noop}
			/>
		)
	})
}

it("renders the streaming tail without rebuilding completed row bodies", () => {
	const messages: ClineMessage[] = [
		{ type: "say", say: "text", ts: 1, text: "First response" },
		{ type: "say", say: "text", ts: 2, text: "Another response" },
		{ type: "say", say: "text", ts: 3, text: "Starting to stream", partial: true },
	]
	renderWithExtensionState(<Rows />, { state: { clineMessages: messages, currentTaskId: "fixture" } })
	const original = screen.getByText("First response")
	translate.mockClear()

	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "messageUpdated", clineMessage: { ...messages[2], text: "New content at the tail" } },
			}),
		)
	})

	expect(screen.getByText("First response")).toBe(original)
	expect(screen.getByText("New content at the tail")).toBeInTheDocument()
	expect(translate.mock.calls.filter(([key]) => key === "chat:text.rooSaid")).toHaveLength(1)
})

it("updates a subtask result link when the host posts completion metadata", () => {
	const result: ClineMessage = { type: "say", say: "subtask_result", ts: 1, text: "Subtask completed" }
	const currentTaskItem: HistoryItem = {
		id: "fixture",
		number: 1,
		ts: 1,
		task: "Parent task",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	}
	renderWithExtensionState(<Rows />, {
		state: { clineMessages: [result], currentTaskId: "fixture", currentTaskItem },
	})
	const linkName = "chat:subtasks.goToSubtask"
	expect(screen.queryByRole("button", { name: linkName })).not.toBeInTheDocument()

	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "state",
					state: {
						currentTaskId: "fixture",
						currentTaskItem: { ...currentTaskItem, completedByChildId: "completed-child" },
					},
				},
			}),
		)
	})

	expect(screen.getByRole("button", { name: linkName })).toBeInTheDocument()
})

it("only rerenders historical transcript details when their source changes", () => {
	const result: ClineMessage = {
		type: "say",
		say: "subtask_result",
		ts: 1,
		text: "Subtask completed",
		childTaskId: "child-task",
	}
	const todoUpdate = (ts: number, status: TodoStatus): ClineMessage => ({
		type: "ask",
		ask: "tool",
		ts,
		text: JSON.stringify({ tool: "updateTodoList", todos: [{ id: "todo-1", content: "Inspect files", status }] }),
	})
	const tail: ClineMessage = { type: "say", say: "text", ts: 4, text: "Streaming", partial: true }
	const clineMessages = [result, todoUpdate(2, "pending"), todoUpdate(3, "completed"), tail]
	renderWithExtensionState(<Rows />, { state: { clineMessages, currentTaskId: "fixture" } })
	expect(screen.getAllByText("Inspect files")).toHaveLength(2)
	translate.mockClear()
	const updateMessage = (clineMessage: ClineMessage) =>
		act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "messageUpdated", clineMessage } })))

	updateMessage({ ...tail, text: "Latest streaming text" })
	expect(screen.getByText("Latest streaming text")).toBeInTheDocument()
	expect(translate).not.toHaveBeenCalledWith("chat:subtasks.resultContent")
	expect(translate).not.toHaveBeenCalledWith("chat:todo.updated")

	updateMessage(todoUpdate(2, "completed"))
	expect(screen.getAllByText("Inspect files")).toHaveLength(1)
	expect(screen.getByRole("button", { name: "chat:subtasks.goToSubtask" })).toBeInTheDocument()
})
