import { render, screen } from "@testing-library/react"

import { McpErrorRow } from "../McpErrorRow"

describe("McpErrorRow timestamps", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(new Date(2026, 10, 18, 12))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	function renderTimestamp(timestamp: number) {
		render(<McpErrorRow error={{ timestamp, level: "error", message: "Connection failed" }} />)
	}

	it.each([
		[-7, 15, "11/11/2026"],
		[-6, 15, "last Thursday at 3:05 PM"],
		[-1, 15, "yesterday at 3:05 PM"],
		[0, 0, "today at 12:05 AM"],
		[0, 12, "today at 12:05 PM"],
		[1, 15, "tomorrow at 3:05 PM"],
		[6, 15, "Tuesday at 3:05 PM"],
		[7, 15, "11/25/2026"],
	])("formats a day offset of %i and hour %i", (days, hours, expected) => {
		renderTimestamp(new Date(2026, 10, 18 + days, hours, 5).getTime())
		expect(screen.getByText(expected)).toBeInTheDocument()
	})

	it("uses local midnight for relative days", () => {
		vi.setSystemTime(new Date(2026, 10, 2, 0, 1))
		renderTimestamp(new Date(2026, 10, 1, 23, 59).getTime())
		expect(screen.getByText("yesterday at 11:59 PM")).toBeInTheDocument()
	})

	it("pads years below 100 in absolute dates", () => {
		renderTimestamp(new Date(2026, 2, 3, 12).setFullYear(7))
		expect(screen.getByText("03/03/0007")).toBeInTheDocument()
	})
})
