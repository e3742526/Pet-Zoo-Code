import { renderWithExtensionState, screen, fireEvent } from "@/utils/test-utils"
import type { HistoryItem } from "@roo-code/types"

import HistoryView from "../HistoryView"

vi.mock("@src/utils/vscode")

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

const mockTaskHistory: HistoryItem[] = [
	{
		id: "1",
		number: 1,
		task: "Test task 1",
		ts: Date.now(),
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.002,
		workspace: "/test/workspace",
	},
	{
		id: "2",
		number: 2,
		task: "Test task 2",
		ts: Date.now() + 1000,
		tokensIn: 200,
		tokensOut: 100,
		totalCost: 0.003,
		workspace: "/test/workspace",
	},
]

function renderHistory(onDone: () => void) {
	return renderWithExtensionState(<HistoryView onDone={onDone} />, {
		state: { taskHistory: mockTaskHistory, cwd: "/test/workspace" },
	})
}

describe("HistoryView", () => {
	it("renders the history interface", () => {
		const onDone = vi.fn()
		renderHistory(onDone)

		// Check for main UI elements
		expect(screen.getByText("history:history")).toBeInTheDocument()
		expect(screen.getByText("history:done")).toBeInTheDocument()
		expect(screen.getByPlaceholderText("history:searchPlaceholder")).toBeInTheDocument()
	})

	it("calls onDone when done button is clicked", () => {
		const onDone = vi.fn()
		renderHistory(onDone)

		const doneButton = screen.getByText("history:done")
		fireEvent.click(doneButton)

		expect(onDone).toHaveBeenCalled()
	})
})
