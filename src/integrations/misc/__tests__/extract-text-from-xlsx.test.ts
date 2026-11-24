import ExcelJS from "exceljs"
import { extractTextFromXLSX, formatWorkbook } from "../extract-text-from-xlsx"
import { extractTextFromFile } from "../extract-text"

describe("XLSX buffer decoding", () => {
	it("preserves empty columns in a populated row from real XLSX bytes", async () => {
		const workbook = new ExcelJS.Workbook()
		const worksheet = workbook.addWorksheet("Sparse")
		worksheet.getCell("A1").value = null
		worksheet.getCell("B1").value = "middle"
		worksheet.getCell("C1").value = undefined
		worksheet.getCell("D1").value = "end"

		const expected = "--- Sheet: Sparse ---\n\tmiddle\t\tend"
		expect(formatWorkbook(workbook)).toBe(expected)
		const source = Buffer.from(await workbook.xlsx.writeBuffer())
		expect(await extractTextFromXLSX(source)).toBe(expected)
	})

	it("decodes only the selected buffer view when another workbook follows in the backing buffer", async () => {
		const approved = new ExcelJS.Workbook()
		const worksheet = approved.addWorksheet("Selected")
		worksheet.getCell("A1").value = "approved cell"
		worksheet.getCell("B1").value = 42
		const approvedBytes = Buffer.from(await approved.xlsx.writeBuffer())

		const unapproved = new ExcelJS.Workbook()
		unapproved.addWorksheet("Unapproved").getCell("A1").value = "outside selected bytes"
		const unapprovedBytes = Buffer.from(await unapproved.xlsx.writeBuffer())
		const prefix = Buffer.from("unapproved prefix")
		const backing = Buffer.concat([prefix, approvedBytes, unapprovedBytes])
		const source = backing.subarray(prefix.length, prefix.length + approvedBytes.length)

		// Passing source.buffer would expose the later, unapproved ZIP archive to the decoder.
		expect(source.byteOffset).toBeGreaterThan(0)
		expect(source.byteLength).toBeLessThan(source.buffer.byteLength)
		expect(await extractTextFromXLSX(source)).toBe("--- Sheet: Selected ---\napproved cell\t42")
	})

	it("rejects invalid workbook bytes instead of returning empty workbook text", async () => {
		await expect(extractTextFromXLSX(Buffer.from("not an XLSX archive"))).rejects.toThrow()
	})

	it("reads shared formulas and cached results that include zero, false, and errors", async () => {
		const workbook = new ExcelJS.Workbook()
		const worksheet = workbook.addWorksheet("Formulas")
		worksheet.getColumn("A").values = [4, -1, 20]
		worksheet.fillFormula("B1:B3", "A1+1", [5, 0])
		worksheet.getCell("C1").value = { formula: "A1<0", result: false }
		worksheet.getCell("C2").value = { formula: "1/0", result: { error: "#DIV/0!" } }
		worksheet.getCell("C3").value = {
			formula: "DATE(2024,10,30)+TIME(14,5,6)",
			result: new Date("2024-10-30T14:05:06Z"),
		}
		worksheet.getCell("C3").numFmt = "yyyy-mm-dd hh:mm:ss"

		const expected = [
			"--- Sheet: Formulas ---",
			"4\t5\tfalse",
			"-1\t0\t[Error: #DIV/0!]",
			"20\t[Formula: A3+1]\t2024-10-30 14:05:06",
		].join("\n")
		expect(formatWorkbook(workbook)).toBe(expected)
		expect(await extractTextFromXLSX(Buffer.from(await workbook.xlsx.writeBuffer()))).toBe(expected)
	})

	it.each([false, true])("reads clock times and elapsed formats with date1904=%s", async (date1904) => {
		const workbook = new ExcelJS.Workbook()
		workbook.properties.date1904 = date1904
		const worksheet = workbook.addWorksheet("Times")
		const cases = [
			{ serial: 0.75, format: 'h:mm" [m]"', expected: "18:00:00" },
			{ serial: 0.25, format: "h:mm\\ \\d\\a\\i\\l\\y", expected: "06:00:00" },
			{ serial: 1.5, format: "[h]:mm", expected: "36:00" },
			{ serial: 1.5, format: "[h]", expected: "36" },
			{ serial: 1 + 3630 / 86400, format: "[mm]:ss", expected: "1500:30" },
			{ serial: 1 / 16, format: "[ss]", expected: "5400" },
		]
		cases.forEach(({ serial, format }, index) => {
			const cell = worksheet.getCell(index + 1, 1)
			cell.value = serial
			cell.numFmt = format
		})

		const expected = ["--- Sheet: Times ---", ...cases.map(({ expected }) => expected)].join("\n")
		expect(formatWorkbook(workbook)).toBe(expected)
		expect(await extractTextFromXLSX(Buffer.from(await workbook.xlsx.writeBuffer()))).toBe(expected)
	})

	it("keeps the original day in date-only cells and rounds visible times", async () => {
		const workbook = new ExcelJS.Workbook()
		const worksheet = workbook.addWorksheet("Dates")
		const nearMidnight = new Date("2024-09-30T23:59:59.900Z")
		worksheet.getCell("A1").value = nearMidnight
		worksheet.getCell("A1").numFmt = "yyyy-mm-dd"
		worksheet.getCell("B1").value = nearMidnight
		worksheet.getCell("B1").numFmt = "yyyy-mm-dd hh:mm:ss"
		worksheet.getCell("C1").value = nearMidnight
		worksheet.getCell("C1").numFmt = "hh:mm:ss"

		const expected = "--- Sheet: Dates ---\n2024-09-30\t2024-10-01 00:00:00\t00:00:00"
		expect(formatWorkbook(workbook)).toBe(expected)
		expect(await extractTextFromXLSX(Buffer.from(await workbook.xlsx.writeBuffer()))).toBe(expected)
	})
})

describe("formatWorkbook", () => {
	describe("basic functionality", () => {
		it("should extract text with proper formatting", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Sheet1")

			worksheet.getCell("A1").value = "Hello"
			worksheet.getCell("B1").value = "World"
			worksheet.getCell("A2").value = "Test"
			worksheet.getCell("B2").value = 123

			const result = formatWorkbook(workbook)

			expect(result).toContain("--- Sheet: Sheet1 ---")
			expect(result).toContain("Hello\tWorld")
			expect(result).toContain("Test\t123")
		})

		it("should skip rows with no content", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Sheet1")

			worksheet.getCell("A1").value = "Row 1"
			// Row 2 is completely empty
			worksheet.getCell("A3").value = "Row 3"

			const result = formatWorkbook(workbook)

			expect(result).toContain("Row 1")
			expect(result).toContain("Row 3")
			// Should not contain empty rows
			expect(result).not.toMatch(/\n\t*\n/)
		})
	})

	describe("sheet handling", () => {
		it("should process multiple sheets", () => {
			const workbook = new ExcelJS.Workbook()

			const sheet1 = workbook.addWorksheet("First Sheet")
			sheet1.getCell("A1").value = "Sheet 1 Data"

			const sheet2 = workbook.addWorksheet("Second Sheet")
			sheet2.getCell("A1").value = "Sheet 2 Data"

			const result = formatWorkbook(workbook)

			expect(result).toContain("--- Sheet: First Sheet ---")
			expect(result).toContain("Sheet 1 Data")
			expect(result).toContain("--- Sheet: Second Sheet ---")
			expect(result).toContain("Sheet 2 Data")
		})

		it("should skip hidden sheets", () => {
			const workbook = new ExcelJS.Workbook()

			const visibleSheet = workbook.addWorksheet("Visible Sheet")
			visibleSheet.getCell("A1").value = "Visible Data"

			const hiddenSheet = workbook.addWorksheet("Hidden Sheet")
			hiddenSheet.getCell("A1").value = "Hidden Data"
			hiddenSheet.state = "hidden"

			const result = formatWorkbook(workbook)

			expect(result).toContain("--- Sheet: Visible Sheet ---")
			expect(result).toContain("Visible Data")
			expect(result).not.toContain("--- Sheet: Hidden Sheet ---")
			expect(result).not.toContain("Hidden Data")
		})

		it("should skip very hidden sheets", () => {
			const workbook = new ExcelJS.Workbook()

			const visibleSheet = workbook.addWorksheet("Visible Sheet")
			visibleSheet.getCell("A1").value = "Visible Data"

			const veryHiddenSheet = workbook.addWorksheet("Very Hidden Sheet")
			veryHiddenSheet.getCell("A1").value = "Very Hidden Data"
			veryHiddenSheet.state = "veryHidden"

			const result = formatWorkbook(workbook)

			expect(result).toContain("--- Sheet: Visible Sheet ---")
			expect(result).toContain("Visible Data")
			expect(result).not.toContain("--- Sheet: Very Hidden Sheet ---")
			expect(result).not.toContain("Very Hidden Data")
		})
	})

	describe("formatCellValue logic", () => {
		it("should handle null and undefined values", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Sheet1")

			worksheet.getCell("A1").value = "Before"
			worksheet.getCell("A2").value = null
			worksheet.getCell("A3").value = undefined
			worksheet.getCell("A4").value = "After"

			const result = formatWorkbook(workbook)

			expect(result).toContain("Before")
			expect(result).toContain("After")
			// Should handle null/undefined as empty strings
			const lines = result.split("\n")
			const dataLines = lines.filter((line) => !line.startsWith("---") && line.trim())
			expect(dataLines).toHaveLength(2) // Only 'Before' and 'After' should create content
		})

		it("should format dates correctly", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Sheet1")

			const testDate = new Date("2023-12-25")
			worksheet.getCell("A1").value = testDate

			const result = formatWorkbook(workbook)

			expect(result).toContain("2023-12-25")
		})

		it("should handle error values", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Sheet1")

			worksheet.getCell("A1").value = { error: "#DIV/0!" }

			const result = formatWorkbook(workbook)

			expect(result).toContain("[Error: #DIV/0!]")
		})

		it("should handle rich text", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Sheet1")

			worksheet.getCell("A1").value = {
				richText: [{ text: "Hello " }, { text: "World", font: { bold: true } }],
			}

			const result = formatWorkbook(workbook)

			expect(result).toContain("Hello World")
		})

		it("should handle hyperlinks", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Sheet1")

			worksheet.getCell("A1").value = {
				text: "Roo Code",
				hyperlink: "https://roocode.com/",
			}

			const result = formatWorkbook(workbook)

			expect(result).toContain("Roo Code (https://roocode.com/)")
		})

		it("should handle formulas with and without results", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Sheet1")

			worksheet.getCell("A1").value = { formula: "A2+A3", result: 30 }
			worksheet.getCell("A2").value = { formula: "SUM(B1:B10)" }

			const result = formatWorkbook(workbook)

			expect(result).toContain("30") // Formula with result
			expect(result).toContain("[Formula: SUM(B1:B10)]") // Formula without result
		})
	})

	describe("edge cases", () => {
		it("includes row 50000, marks row 50001 as truncated, and still formats the next sheet", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Large")
			worksheet.getCell("A50000").value = "last included row"
			worksheet.getCell("A50001").value = "excluded row content"
			workbook.addWorksheet("Next").getCell("A1").value = "next sheet content"

			expect(formatWorkbook(workbook)).toBe(
				"--- Sheet: Large ---\nlast included row\n[... truncated at row 50001 ...]\n\n" +
					"--- Sheet: Next ---\nnext sheet content",
			)
		})

		it("should handle empty workbook", () => {
			const workbook = new ExcelJS.Workbook()
			workbook.addWorksheet("Empty Sheet")

			const result = formatWorkbook(workbook)

			expect(result).toContain("--- Sheet: Empty Sheet ---")
			expect(result.trim()).toBe("--- Sheet: Empty Sheet ---")
		})

		it("should handle workbook with only empty cells", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Sheet1")

			// Set cells but leave them empty
			worksheet.getCell("A1").value = ""
			worksheet.getCell("B1").value = ""

			const result = formatWorkbook(workbook)

			expect(result).toContain("--- Sheet: Sheet1 ---")
			// Should not contain any data rows since empty strings don't count as content
			const lines = result.split("\n").filter((line) => line.trim() && !line.startsWith("---"))
			expect(lines).toHaveLength(0)
		})
	})

	describe("workbook formatting and path adapter", () => {
		it("should work with workbook objects", () => {
			const workbook = new ExcelJS.Workbook()
			const worksheet = workbook.addWorksheet("Test")
			worksheet.getCell("A1").value = "Test Data"

			const result = formatWorkbook(workbook)

			expect(result).toContain("Test Data")
		})

		it("should reject invalid file paths", async () => {
			await expect(extractTextFromFile("/non/existent/file.xlsx")).rejects.toThrow()
		})
	})
})
