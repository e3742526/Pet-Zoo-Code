import ExcelJS from "exceljs"
import type { Buffer as NodeBuffer } from "node:buffer"

// ExcelJS 4.4.0 declares its Buffer as an ArrayBuffer, but its Node loader accepts
// Node Buffers directly. Correct that boundary without casts or copying the input.
declare module "exceljs" {
	interface Xlsx {
		load(buffer: NodeBuffer, options?: Partial<XlsxReadOptions>): Promise<Workbook>
	}
}

const ROW_LIMIT = 50000
const MILLISECONDS_PER_DAY = 86_400_000
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const EXCEL_1904_EPOCH = Date.UTC(1904, 0, 1)

function formatElapsedTime(seconds: number, elapsedUnit: string, format: string): string {
	const duration = Math.abs(seconds)
	const unit = elapsedUnit[0]
	const unitSeconds = unit === "h" ? 3600 : unit === "m" ? 60 : 1
	const parts = [String(Math.floor(duration / unitSeconds)).padStart(elapsedUnit.length, "0")]
	if (unit === "h" && format.includes("m")) {
		parts.push(String(Math.floor(duration / 60) % 60).padStart(2, "0"))
	}
	if (unit !== "s" && format.includes("s")) {
		parts.push(String(duration % 60).padStart(2, "0"))
	}
	return (seconds < 0 ? "-" : "") + parts.join(":")
}

/** ExcelJS can return either a UTC Date or the original day count for an elapsed format. */
function formatTemporalValue(value: Date | number, cell: ExcelJS.Cell): string {
	// Remove literals before reading elapsed directives such as [h] or [mm].
	const format = (cell.numFmt ?? "")
		.replace(/"[^"]*"|[\\_*]./g, "")
		.split(";")[0]
		.toLowerCase()
	const elapsedUnit = format.match(/\[(h+|m+|s+)\]/)?.[1]
	// The loader can remove escape markers, leaving literal words in the format.
	const tokens =
		format
			.replace(/\[[^\]]*\]/g, "")
			.match(/\b[ymdhs]+\b/g)
			?.join(" ") ?? ""
	const hasTime = /[hs]/.test(tokens)
	if (typeof value === "number" && !elapsedUnit && !hasTime) {
		return String(value)
	}

	const epoch = cell.worksheet.workbook.properties.date1904 ? EXCEL_1904_EPOCH : EXCEL_EPOCH
	const timestamp = typeof value === "number" ? epoch + value * MILLISECONDS_PER_DAY : value.getTime()
	if (elapsedUnit) {
		const seconds = Math.round((timestamp - epoch) / 1000)
		return Number.isSafeInteger(seconds) ? formatElapsedTime(seconds, elapsedUnit, tokens) : String(value)
	}

	const date = new Date(hasTime ? Math.round(timestamp / 1000) * 1000 : timestamp)
	if (Number.isNaN(date.getTime())) {
		return String(value)
	}

	const [calendar, clock] = date.toISOString().split("T")
	if (!hasTime) {
		return calendar
	}
	const time = clock.slice(0, 8)
	return /[dy]|m{3,}/.test(tokens) ? `${calendar} ${time}` : time
}

function formatCellValue(cell: ExcelJS.Cell): string {
	const isFormula = cell.type === ExcelJS.ValueType.Formula
	// Formula values omit false and zero in ExcelJS's value getter. Read the cached result directly.
	const value = isFormula ? cell.result : cell.value
	if (value === null || value === undefined) {
		if (!isFormula) {
			return ""
		}
		const formula = cell.formula
		return formula ? `[Formula: ${formula}]` : "[Formula]"
	}

	// Handle error values (#DIV/0!, #N/A, etc.)
	if (typeof value === "object" && "error" in value) {
		return `[Error: ${value.error}]`
	}

	if (value instanceof Date || (typeof value === "number" && /[hs]|\[/i.test(cell.numFmt ?? ""))) {
		return formatTemporalValue(value, cell)
	}

	// Handle rich text
	if (typeof value === "object" && "richText" in value) {
		return value.richText.map((rt) => rt.text).join("")
	}

	// Handle hyperlinks
	if (typeof value === "object" && "text" in value && "hyperlink" in value) {
		return `${value.text} (${value.hyperlink})`
	}

	return value.toString()
}

export async function extractTextFromXLSX(source: Buffer): Promise<string> {
	const workbook = new ExcelJS.Workbook()
	await workbook.xlsx.load(source)
	return formatWorkbook(workbook)
}

export function formatWorkbook(workbook: ExcelJS.Workbook): string {
	let excelText = ""

	workbook.eachSheet((worksheet, _sheetId) => {
		if (worksheet.state === "hidden" || worksheet.state === "veryHidden") {
			return
		}

		excelText += `--- Sheet: ${worksheet.name} ---\n`

		worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
			if (rowNumber > ROW_LIMIT) {
				excelText += `[... truncated at row ${rowNumber} ...]\n`
				return false
			}

			const rowTexts: string[] = []
			let hasContent = false

			row.eachCell({ includeEmpty: true }, (cell, _colNumber) => {
				const cellText = formatCellValue(cell)
				if (cellText.trim()) {
					hasContent = true
				}
				rowTexts.push(cellText)
			})

			if (hasContent) {
				excelText += rowTexts.join("\t") + "\n"
			}

			return true
		})

		excelText += "\n"
	})

	return excelText.trim()
}
