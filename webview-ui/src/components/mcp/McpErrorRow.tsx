import { useMemo } from "react"

import type { McpErrorEntry } from "@roo-code/types"

const DAY_MS = 24 * 60 * 60 * 1000
const pad = (value: number) => String(value).padStart(2, "0")
const englishWeekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function localCalendarDay(date: Date): number {
	// Put the local date on the UTC calendar so offset changes cannot affect the day difference.
	return new Date(0).setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Keep the English calendar labels and numeric dates used in the MCP error log. */
function formatMcpErrorTimestamp(timestamp: number, now: Date): string {
	const date = new Date(timestamp)
	const days = (localCalendarDay(date) - localCalendarDay(now)) / DAY_MS
	if (!Number.isFinite(days)) {
		throw new RangeError("Invalid time value")
	}
	if (days < -6 || days > 6) {
		const year = date.getFullYear()
		const yearOfEra = year > 0 ? year : 1 - year
		return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${String(yearOfEra).padStart(4, "0")}`
	}

	const hour = date.getHours()
	const time = `${hour % 12 || 12}:${pad(date.getMinutes())} ${hour < 12 ? "AM" : "PM"}`
	switch (days) {
		case -1:
			return `yesterday at ${time}`
		case 0:
			return `today at ${time}`
		case 1:
			return `tomorrow at ${time}`
		default:
			return `${days < 0 ? "last " : ""}${englishWeekdays[date.getDay()]} at ${time}`
	}
}

type McpErrorRowProps = {
	error: McpErrorEntry
}

export const McpErrorRow = ({ error }: McpErrorRowProps) => {
	const color = useMemo(() => {
		switch (error.level) {
			case "error":
				return "var(--vscode-testing-iconFailed)"
			case "warn":
				return "var(--vscode-charts-yellow)"
			case "info":
				return "var(--vscode-testing-iconPassed)"
		}
	}, [error.level])

	return (
		<div className="text-sm bg-vscode-textCodeBlock-background border-l-2 p-2" style={{ borderColor: color }}>
			<div className="mb-1" style={{ color }}>
				{error.message}
			</div>
			<div className="text-xs text-vscode-descriptionForeground">
				{formatMcpErrorTimestamp(error.timestamp, new Date())}
			</div>
		</div>
	)
}
