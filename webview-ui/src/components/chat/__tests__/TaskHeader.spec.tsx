import { providerIdentifiers } from "@roo-code/types"
// npx vitest src/components/chat/__tests__/TaskHeader.spec.tsx

import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"

import type { HistoryItem } from "@roo-code/types"

import TaskHeader, { TaskHeaderProps } from "../TaskHeader"

// Mock i18n
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key, // Simple mock that returns the key
	}),
}))

vi.mock("react-i18next", () => ({
	// Mock initReactI18next to prevent initialization errors in tests
	initReactI18next: {
		type: "3rdParty",
		init: vi.fn(),
	},
}))

// Mock the vscode API - use vi.hoisted to ensure the mock is available when vi.mock is hoisted
const { mockPostMessage } = vi.hoisted(() => ({
	mockPostMessage: vi.fn(),
}))
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
	},
}))

// Mock the VSCodeBadge component
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children }: { children: React.ReactNode }) => <div data-testid="vscode-badge">{children}</div>,
}))

// Create a variable to hold the mock model info for useSelectedModel
let mockModelInfo: { contextWindow: number; maxTokens: number } | undefined = undefined

// Mock useSelectedModel hook
vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({
		provider: providerIdentifiers.anthropic,
		id: "test-model",
		info: mockModelInfo,
		isLoading: false,
		isError: false,
	}),
}))

// Mock getModelMaxOutputTokens from @roo/api
let mockMaxOutputTokens = 0
vi.mock("@roo/api", () => ({
	getModelMaxOutputTokens: () => mockMaxOutputTokens,
}))

describe("TaskHeader", () => {
	const currentTaskItem: HistoryItem = {
		id: "test-task-id",
		number: 1,
		ts: Date.now(),
		task: "Test task",
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.05,
	}
	const defaultProps: TaskHeaderProps = {
		task: { type: "say", ts: Date.now(), text: "Test task", images: [] },
		apiConfiguration: { apiProvider: providerIdentifiers.anthropic, apiModelId: "claude-3-opus-20240229" },
		currentTaskItem,
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.05,
		contextTokens: 200,
		buttonsDisabled: false,
		handleCondenseContext: vi.fn(),
	}

	const renderTaskHeader = (props: Partial<TaskHeaderProps> = {}) => {
		return render(<TaskHeader {...defaultProps} {...props} />)
	}

	it("should display cost when totalCost is greater than 0", () => {
		renderTaskHeader()
		expect(screen.getByText("$0.05")).toBeInTheDocument()
	})

	it("should not display cost when totalCost is 0", () => {
		renderTaskHeader({ totalCost: 0 })
		expect(screen.queryByText("$0.0000")).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is null", () => {
		renderTaskHeader({ totalCost: null as any })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is undefined", () => {
		renderTaskHeader({ totalCost: undefined as any })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is NaN", () => {
		renderTaskHeader({ totalCost: NaN })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should render the condense context button in the collapsed state", () => {
		renderTaskHeader()
		// Button is visible without expanding the task header
		const buttons = screen.getAllByRole("button")
		const condenseButton = buttons.find((button) => button.querySelector("svg.lucide-list-chevrons-down-up"))
		expect(condenseButton).toBeDefined()
		expect(condenseButton?.querySelector("svg")).toBeInTheDocument()
	})

	it("should render the condense context button when expanded", () => {
		renderTaskHeader()
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		const buttons = screen.getAllByRole("button")
		const condenseButton = buttons.find((button) => button.querySelector("svg.lucide-list-chevrons-down-up"))
		expect(condenseButton).toBeDefined()
		expect(condenseButton?.querySelector("svg")).toBeInTheDocument()
	})

	describe("when the task was sent", () => {
		const SENT = new Date(2024, 2, 7, 14, 41, 0, 0).getTime() // years back: a date, not "Today"
		const expand = () => fireEvent.click(screen.getByText("Test task"))
		const task = { ...defaultProps.task, ts: SENT }

		it("shows the time under the expanded task, in the chosen time and date format", () => {
			renderTaskHeader({ task, timeFormat: "24h", dateFormat: "ymd" })
			expand()

			const timestamp = screen.getByTestId("message-timestamp")
			expect(timestamp.textContent).toContain("2024-03-07")
			expect(timestamp.textContent).toContain("14:41")
			expect(timestamp).toHaveAttribute("datetime", new Date(SENT).toISOString())
		})

		it("follows a different format", () => {
			renderTaskHeader({ task, timeFormat: "12h", dateFormat: "dmy" })
			expand()

			const text = screen.getByTestId("message-timestamp").textContent!
			expect(text).toContain("07/03/2024")
			expect(text).toMatch(/2:41\s?PM/i)
		})

		it.each([
			["zero", 0],
			["negative", -1],
			["not a number", Number.NaN],
			["beyond the range of a date", 8.64e15 + 1],
		])("shows no time, and still the expanded task, when the task's time is %s", (_name, ts) => {
			renderTaskHeader({ task: { ...task, ts } })

			expand()

			expect(screen.getByText("chat:task.title")).toBeInTheDocument()
			expect(screen.queryByTestId("message-timestamp")).not.toBeInTheDocument()
		})

		it("leaves no empty block under the expanded task when the time is invalid", () => {
			const valid = renderTaskHeader({ task })
			expand()
			const withTime = valid.container.querySelectorAll("div").length
			valid.unmount()

			const invalid = renderTaskHeader({ task: { ...task, ts: 0 } })
			expand()

			expect(invalid.container.querySelectorAll("div").length).toBe(withTime - 1)
		})

		it("is not shown while the task is collapsed", () => {
			renderTaskHeader({ task })

			expect(screen.queryByTestId("message-timestamp")).not.toBeInTheDocument()
		})

		it("keeps the task expanded when the time is clicked, as for the other controls under the task", () => {
			renderTaskHeader({ task })
			expand()
			expect(screen.getByText("chat:task.title")).toBeInTheDocument()

			fireEvent.click(screen.getByTestId("message-timestamp"))

			expect(screen.getByText("chat:task.title")).toBeInTheDocument()
		})
	})

	it("should call handleCondenseContext when condense context button is clicked", () => {
		const handleCondenseContext = vi.fn()
		renderTaskHeader({ handleCondenseContext })

		// Button is clickable in collapsed state without expanding first
		const buttons = screen.getAllByRole("button")
		const condenseButton = buttons.find((button) => button.querySelector("svg.lucide-list-chevrons-down-up"))
		expect(condenseButton).toBeDefined()
		fireEvent.click(condenseButton!)
		expect(handleCondenseContext).toHaveBeenCalledWith("test-task-id")
		// Clicking the condense button must not expand the header (stopPropagation guard).
		// The expanded state renders the "chat:task.title" label, which stays absent while collapsed.
		expect(screen.queryByText("chat:task.title")).not.toBeInTheDocument()
	})

	it("should disable the condense context button when buttonsDisabled is true", () => {
		const handleCondenseContext = vi.fn()
		renderTaskHeader({ buttonsDisabled: true, handleCondenseContext })

		// Button is disabled in collapsed state without expanding first
		const buttons = screen.getAllByRole("button")
		const condenseButton = buttons.find((button) => button.querySelector("svg.lucide-list-chevrons-down-up"))
		expect(condenseButton).toBeDefined()
		expect(condenseButton).toBeDisabled()
		fireEvent.click(condenseButton!)
		expect(handleCondenseContext).not.toHaveBeenCalled()
	})

	describe("Back to parent task button", () => {
		beforeEach(() => {
			mockPostMessage.mockClear()
		})

		it("should not show back button when parentTaskId is not provided", () => {
			renderTaskHeader()
			expect(screen.queryByText("chat:task.backToParentTask")).not.toBeInTheDocument()
		})

		it("should not show back button when parentTaskId is undefined", () => {
			renderTaskHeader({ parentTaskId: undefined })
			expect(screen.queryByText("chat:task.backToParentTask")).not.toBeInTheDocument()
		})

		it("should show back button when parentTaskId is provided", () => {
			renderTaskHeader({ parentTaskId: "parent-task-123" })
			expect(screen.getByText("chat:task.backToParentTask")).toBeInTheDocument()
		})

		it("should call vscode.postMessage with showTaskWithId when back button is clicked", () => {
			renderTaskHeader({ parentTaskId: "parent-task-123" })

			const backButton = screen.getByText("chat:task.backToParentTask")
			fireEvent.click(backButton)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "parent-task-123",
			})
		})

		it("should show back button with ArrowLeft icon", () => {
			renderTaskHeader({ parentTaskId: "parent-task-123" })

			// Find the button containing the back text and verify it has the ArrowLeft icon
			const backButton = screen.getByText("chat:task.backToParentTask").closest("button")
			expect(backButton).toBeInTheDocument()
			expect(backButton?.querySelector("svg.lucide-arrow-left")).toBeInTheDocument()
		})
	})

	describe("Delegated parent waiting-on-subtask banner", () => {
		const delegatedTask: HistoryItem = {
			...currentTaskItem,
			id: "parent-1",
			status: "delegated",
			awaitingChildId: "child-1",
		}
		beforeEach(() => {
			mockPostMessage.mockClear()
		})

		it("does not show the banner when currentTaskItem is not delegated", () => {
			renderTaskHeader({ currentTaskItem: { ...currentTaskItem, status: "active" } })
			expect(screen.queryByText("chat:task.waitingOnSubtask")).not.toBeInTheDocument()
		})

		it("shows the banner when currentTaskItem is delegated with an awaitingChildId", () => {
			renderTaskHeader({ currentTaskItem: delegatedTask })
			expect(screen.getByText("chat:task.waitingOnSubtask")).toBeInTheDocument()
		})

		it("navigates to the awaited child when the banner is clicked", () => {
			renderTaskHeader({ currentTaskItem: delegatedTask })

			fireEvent.click(screen.getByText("chat:task.waitingOnSubtask"))

			expect(mockPostMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "child-1" })
		})

		it("does not show an Abandon button (removed: implicit sever on re-delegation)", () => {
			renderTaskHeader({ currentTaskItem: delegatedTask })

			expect(screen.getByText("chat:task.waitingOnSubtask")).toBeInTheDocument()
			expect(screen.queryByText("history:abandonSubtask")).not.toBeInTheDocument()
		})
	})

	describe("Rename", () => {
		beforeEach(() => {
			mockPostMessage.mockClear()
		})

		it("shows the custom title instead of the first message when the task is renamed", () => {
			renderTaskHeader({ currentTaskItem: { ...currentTaskItem, title: "My title" } })

			expect(screen.getByText("My title")).toBeInTheDocument()
			expect(screen.queryByText("Test task")).not.toBeInTheDocument()
		})

		it.each([
			["the custom title over the generated title", "My title", "Generated", "My title"],
			["the generated title without a custom title", undefined, "Generated", "Generated"],
		])("shows %s in the collapsed header", (_label, title, autoTitle, expected) => {
			renderTaskHeader({ currentTaskItem: { ...currentTaskItem, title, autoTitle } })

			expect(screen.getByText(expected)).toBeInTheDocument()
			expect(screen.queryByText("Test task")).not.toBeInTheDocument()
		})

		it.each([
			["the custom title", "My title", "My title"],
			["the default label without a custom title", undefined, "chat:task.title"],
		])("shows %s as the expanded heading", (_label, title, expected) => {
			renderTaskHeader({ currentTaskItem: { ...currentTaskItem, title } })
			fireEvent.click(screen.getByText(title ?? "Test task"))

			expect(screen.getByText(expected)).toHaveClass("font-bold")
			expect(screen.queryByTestId("task-title-input")).not.toBeInTheDocument()
		})

		it("closes the header editor on Escape without saving", () => {
			renderTaskHeader()
			fireEvent.click(screen.getByText("Test task"))
			fireEvent.click(screen.getByTestId("rename-current-task-button"))

			fireEvent.keyDown(screen.getByTestId("task-title-input"), { key: "Escape" })

			expect(screen.queryByTestId("task-title-input")).not.toBeInTheDocument()
			expect(screen.getByText("chat:task.title")).toBeInTheDocument()
			expect(mockPostMessage).not.toHaveBeenCalled()
		})

		it("renames from the expanded header without collapsing it", () => {
			renderTaskHeader()
			fireEvent.click(screen.getByText("Test task"))

			fireEvent.click(screen.getByTestId("rename-current-task-button"))
			const input = screen.getByTestId("task-title-input")
			fireEvent.click(input)
			fireEvent.change(input, { target: { value: "Renamed" } })
			fireEvent.keyDown(input, { key: "Enter" })

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "renameTaskWithId",
				taskId: "test-task-id",
				text: "Renamed",
			})
			expect(screen.queryByTestId("task-title-input")).not.toBeInTheDocument()
			expect(screen.getByTestId("rename-current-task-button")).toBeInTheDocument()
		})
	})

	describe("Context window percentage calculation", () => {
		// The percentage should be calculated as:
		// contextTokens / (contextWindow - reservedForOutput) * 100
		// This represents the percentage of AVAILABLE input space used,
		// not the percentage of the total context window.

		beforeEach(() => {
			// Set up mock model with known contextWindow
			mockModelInfo = { contextWindow: 1000, maxTokens: 200 }
			// Set up mock for getModelMaxOutputTokens to return reservedForOutput
			mockMaxOutputTokens = 200
		})

		afterEach(() => {
			// Reset mocks
			mockModelInfo = undefined
			mockMaxOutputTokens = 0
		})

		it("should calculate percentage based on available input space, not total context window", () => {
			// With the formula: contextTokens / (contextWindow - reservedForOutput) * 100
			// If contextTokens = 200, contextWindow = 1000, reservedForOutput = 200
			// Then available input space = 1000 - 200 = 800
			// Percentage = 200 / 800 * 100 = 25%
			//
			// Old (incorrect) formula would have been: (200 + 200) / 1000 * 100 = 40%

			renderTaskHeader({ contextTokens: 200 })

			// The percentage should be rendered in the collapsed header state
			// Verify that 25% is displayed (correct formula) and NOT 40% (old incorrect formula)
			expect(screen.getByText("25%")).toBeInTheDocument()
			expect(screen.queryByText("40%")).not.toBeInTheDocument()
		})

		it("should handle edge case when available input space is zero", () => {
			// When contextWindow equals reservedForOutput, available space is 0
			// The percentage should be 0 to avoid division by zero
			mockModelInfo = { contextWindow: 200, maxTokens: 200 }
			mockMaxOutputTokens = 200

			renderTaskHeader({ contextTokens: 100 })

			// Should show 0% when available input space is 0
			expect(screen.getByText("0%")).toBeInTheDocument()
		})

		it("should treat a negative maxTokens (vscode-lm reports -1) as zero reserve", () => {
			// vscode-lm reports maxTokens: -1 (unlimited). The guard must treat that negative reserve
			// as zero, so available space == contextWindow rather than being inflated by a kept -1.
			mockModelInfo = { contextWindow: 1000, maxTokens: -1 }
			mockMaxOutputTokens = -1

			renderTaskHeader({ contextTokens: 250 })

			expect(screen.getByText("25%")).toBeInTheDocument()
		})
	})
})
