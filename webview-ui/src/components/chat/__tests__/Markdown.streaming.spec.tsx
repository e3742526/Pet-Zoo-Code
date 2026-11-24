import { act, fireEvent, screen } from "@testing-library/react"

import { render, renderWithExtensionState } from "@/utils/test-utils"

import { Markdown } from "../Markdown"
import { ReasoningBlock } from "../ReasoningBlock"

const longPrefix = "A completed paragraph provides background for the streamed response. ".repeat(155) + "\n\n"
const { copyWithFeedback } = vi.hoisted(() => ({ copyWithFeedback: vi.fn(async (_text: string) => false) }))

vi.mock("@src/utils/clipboard", () => ({ useCopyToClipboard: () => ({ copyWithFeedback }) }))
vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

function advance(ms: number) {
	act(() => vi.advanceTimersByTime(ms))
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
})

afterEach(() => vi.useRealTimers())

it("displays short partial updates and the first long update immediately", () => {
	const { rerender } = render(<Markdown markdown="First words" partial />)

	rerender(<Markdown markdown="More words" partial />)
	expect(screen.getByText("More words")).toBeInTheDocument()

	rerender(<Markdown markdown={longPrefix + "First long tail"} partial />)
	expect(screen.getByText("First long tail")).toBeInTheDocument()
})

it("shows the newest partial at the next deadline and the final content immediately", () => {
	const { rerender, container } = render(<Markdown markdown={longPrefix + "Initial tail"} partial />)

	advance(120)
	rerender(<Markdown markdown={longPrefix + "Intermediate tail"} partial />)
	advance(60)
	rerender(<Markdown markdown={longPrefix + "Latest partial tail"} partial />)
	advance(59)
	expect(screen.getByText("Initial tail")).toBeInTheDocument()
	expect(screen.queryByText("Intermediate tail")).not.toBeInTheDocument()
	advance(1)
	expect(screen.getByText("Latest partial tail")).toBeInTheDocument()

	rerender(<Markdown markdown={longPrefix + "Queued tail"} partial />)
	const completed = longPrefix + "**Completed tail**"
	rerender(<Markdown markdown={completed} partial={false} />)
	expect(screen.getByText("Completed tail")).toBeInTheDocument()

	fireEvent.mouseEnter(container.firstElementChild!)
	fireEvent.click(container.querySelector(".copy-button")!)
	expect(copyWithFeedback).toHaveBeenCalledWith(completed)

	advance(240)
	expect(screen.getByText("Completed tail")).toBeInTheDocument()
	expect(screen.queryByText("Queued tail")).not.toBeInTheDocument()
})

it("flushes the completed reasoning text even while the task continues", () => {
	const { rerender } = renderWithExtensionState(
		<ReasoningBlock content={longPrefix + "Initial thought"} partial ts={1} isLast isStreaming />,
		{ state: { reasoningBlockCollapsed: false } },
	)

	advance(120)
	rerender(<ReasoningBlock content={longPrefix + "Queued thought"} partial ts={1} isLast isStreaming />)
	expect(screen.getByText("Initial thought")).toBeInTheDocument()
	rerender(<ReasoningBlock content={longPrefix + "Final thought"} partial={false} ts={1} isLast isStreaming />)
	expect(screen.getByText("Final thought")).toBeInTheDocument()
	advance(240)
	expect(screen.queryByText("Queued thought")).not.toBeInTheDocument()
})
