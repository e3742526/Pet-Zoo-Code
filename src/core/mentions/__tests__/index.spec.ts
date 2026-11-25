// npx vitest core/mentions/__tests__/index.spec.ts

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

import * as extractText from "../../../integrations/misc/extract-text"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"
import { parseMentions } from "../index"

vi.mock("vscode", async (importOriginal) => ({
	...(await importOriginal<typeof import("vscode")>()),
	RelativePattern: class {},
}))

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
}))

describe("parseMentions - URL mention handling", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should replace URL mentions with quoted URL reference", async () => {
		const result = await parseMentions("Check @https://example.com", "/test")

		// URL mentions are now replaced with a quoted reference (no fetching)
		expect(result.text).toContain("'https://example.com'")
	})
})

describe("parseMentions - folder content", () => {
	let root: string
	let folder: string

	beforeEach(async () => {
		root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "folder-mention-")))
		folder = path.join(root, "fixtures")
		await fs.mkdir(folder)
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await fs.rm(root, { recursive: true, force: true })
	})

	it("reads an absolute open-tab mention from outside the task directory", async () => {
		const file = path.join(root, "open notes.txt")
		await fs.writeFile(file, "Notes from the open tab.")
		const mention = `@/${file.toPosix().replace(/ /g, "\\ ")}`

		const result = await parseMentions(`Read ${mention}`, folder)

		expect(result.contentBlocks).toEqual([
			expect.objectContaining({ type: "file", content: expect.stringContaining("Notes from the open tab.") }),
		])
	})

	it("includes all available text in a folder within the limit", async () => {
		await fs.mkdir(path.join(folder, "nested"))
		await fs.writeFile(path.join(folder, "small.txt"), "small file contents")

		const { contentBlocks } = await parseMentions("@/fixtures/", root)
		expect(contentBlocks[0].content).toContain("nested/\n")
		expect(contentBlocks[0].content).toContain("small file contents")
		expect(contentBlocks[0].content).not.toContain("Folder content limit reached.")
	})

	it("lists every file and stops extracting text after 20 files", async () => {
		const files = Array.from({ length: 24 }, (_, index) => `file-${index}.txt`)
		await Promise.all(files.map((file) => fs.writeFile(path.join(folder, file), `Contents of ${file}`)))
		const extract = vi.spyOn(extractText, "extractTextFromFileWithMetadata")

		const { contentBlocks } = await parseMentions("@/fixtures/", root)
		const { content } = contentBlocks[0]
		const listing = content.split("\n\n")[0].split("\n").slice(2)
		expect(listing.map((line) => line.slice(4))).toEqual(expect.arrayContaining(files))
		expect(extract).toHaveBeenCalledTimes(20)
		expect(content.match(/^File: /gm)).toHaveLength(20)
		expect(content).toContain("Use read_file")
	})

	it("limits the combined UTF-8 size and still expands a direct mention of an omitted file", async () => {
		const files = ["first.txt", "second.txt"]
		const multibyteText = `${"測".repeat(40)}\n`.repeat(400).trimEnd()
		await Promise.all(files.map((file) => fs.writeFile(path.join(folder, file), multibyteText)))

		const { contentBlocks } = await parseMentions("@/fixtures/", root)
		const { content } = contentBlocks[0]
		expect(content.match(/^File: /gm)).toHaveLength(1)
		expect(content).toContain("Use read_file")
		const inlined = content.split("--- File Contents ---\n\n")[1].split("\n\nFolder content limit reached.")[0]
		expect(Buffer.byteLength(inlined)).toBeLessThanOrEqual(64 * 1024)
		const omitted = files.find((file) => !inlined.includes(`File: fixtures/${file}\n`))
		expect(omitted).toBeDefined()

		const direct = await parseMentions(`@/fixtures/ @/fixtures/${omitted}`, root)
		expect(direct.contentBlocks[1].metadata).toMatchObject({ returnedLines: 400, wasTruncated: false })
	})

	it("skips an oversized file and still includes small files and the requested ignored names", async () => {
		await Promise.all([
			fs.writeFile(path.join(folder, "large.txt"), `${"測".repeat(60)}\n`.repeat(400)),
			fs.writeFile(path.join(folder, "small.txt"), "small file contents"),
			fs.writeFile(path.join(folder, "ignored.txt"), "ignored file contents"),
			fs.writeFile(path.join(folder, "binary.png"), Buffer.alloc(512)),
			fs.writeFile(path.join(root, ".rooignore"), "ignored.txt\n"),
		])
		const ignore = new RooIgnoreController(root)
		try {
			await ignore.initialize()
			const { contentBlocks } = await parseMentions("@/fixtures/", root, undefined, ignore, true)
			const { content } = contentBlocks[0]
			expect(content.match(/^File: /gm)).toHaveLength(1)
			expect(content).toContain("small file contents")
			expect(content).toContain("🔒 ignored.txt")
			expect(content).toContain("binary.png")
			expect(content).not.toContain("ignored file contents")
			expect(content).toContain("Use read_file")
		} finally {
			ignore.dispose()
		}
	})
})
