import { promises as fs } from "fs"
import * as os from "os"
import * as path from "path"

import { ensurePrivateDirectory } from "../base-handler"

describe.skipIf(process.platform === "win32")("ensurePrivateDirectory", () => {
	let root: string

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-cli-private-"))
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await fs.rm(root, { recursive: true, force: true })
	})

	it("creates a folder that only the owner can use", async () => {
		const directory = path.join(root, "new")
		await ensurePrivateDirectory(directory)
		expect((await fs.stat(directory)).mode & 0o777).toBe(0o700)
	})

	it("accepts the user's existing folder and tightens its permissions", async () => {
		const directory = path.join(root, "existing")
		await fs.mkdir(directory)
		await fs.chmod(directory, 0o777)
		await ensurePrivateDirectory(directory)
		expect((await fs.stat(directory)).mode & 0o777).toBe(0o700)
	})

	it("rejects a link, even one that points at the user's own folder", async () => {
		const link = path.join(root, "link")
		await fs.symlink(root, link)
		await expect(ensurePrivateDirectory(link)).rejects.toThrow(/not a private folder/)
	})

	it("rejects a file", async () => {
		const file = path.join(root, "file")
		await fs.writeFile(file, "")
		await expect(ensurePrivateDirectory(file)).rejects.toThrow(/not a private folder/)
	})

	it("rejects a folder that another user owns", async () => {
		const owner = (await fs.stat(root)).uid
		vi.spyOn(process, "getuid").mockReturnValue(owner + 1)
		await expect(ensurePrivateDirectory(root)).rejects.toThrow(/not a private folder/)
	})
})
