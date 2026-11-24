import { act, fireEvent, screen } from "@testing-library/react"
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

it("renders only the active reasoning block during streaming", () => {
	const messages: ClineMessage[] = [
		{ type: "say", say: "reasoning", ts: 1, text: "Completed thought" },
		{ type: "say", say: "reasoning", ts: 2, text: "Starting a thought", partial: true },
	]
	renderWithExtensionState(<Rows />, {
		state: { clineMessages: messages, currentTaskId: "fixture", reasoningBlockCollapsed: false },
	})
	const completed = screen.getByText("Completed thought")
	translate.mockClear()

	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "messageUpdated", clineMessage: { ...messages[1], text: "More reasoning at the tail" } },
			}),
		)
	})

	expect(screen.getByText("Completed thought")).toBe(completed)
	expect(screen.getByText("More reasoning at the tail")).toBeInTheDocument()
	expect(translate.mock.calls.filter(([key]) => key === "chat:reasoning.thinking")).toHaveLength(1)
})

it("allows local reasoning toggles and applies changes to the saved collapse preference", () => {
	const clineMessages: ClineMessage[] = [
		{ type: "say", say: "reasoning", ts: 1, text: "First thought" },
		{ type: "say", say: "reasoning", ts: 2, text: "Second thought" },
	]
	renderWithExtensionState(<Rows />, {
		state: { clineMessages, currentTaskId: "fixture", reasoningBlockCollapsed: false },
	})

	fireEvent.click(screen.getAllByText("chat:reasoning.thinking")[0])
	expect(screen.queryByText("First thought")).not.toBeInTheDocument()
	expect(screen.getByText("Second thought")).toBeInTheDocument()

	const setSavedPreference = (reasoningBlockCollapsed: boolean) =>
		act(() =>
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "state", state: { reasoningBlockCollapsed } },
				}),
			),
		)

	setSavedPreference(true)
	expect(screen.queryByText("Second thought")).not.toBeInTheDocument()
	setSavedPreference(false)
	expect(screen.getByText("First thought")).toBeInTheDocument()
	expect(screen.getByText("Second thought")).toBeInTheDocument()
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
