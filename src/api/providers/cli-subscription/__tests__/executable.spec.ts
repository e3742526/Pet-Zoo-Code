import { promises as fs } from "fs"
import * as os from "os"
import * as path from "path"

import { expandHomeDirectory, resolveCliExecutable } from "../executable"

describe.skipIf(process.platform === "win32")("resolveCliExecutable", () => {
	let directory: string
	let originalPath: string | undefined

	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-cli-bin-"))
		await fs.writeFile(path.join(directory, "zoo-test-cli"), "#!/bin/sh\n", { mode: 0o755 })
		await fs.writeFile(path.join(directory, "not-executable"), "", { mode: 0o644 })
		originalPath = process.env.PATH
		process.env.PATH = `${directory}${path.delimiter}${originalPath ?? ""}`
	})

	afterEach(async () => {
		process.env.PATH = originalPath
		await fs.rm(directory, { recursive: true, force: true })
	})

	it("finds the default name in PATH", async () => {
		await expect(resolveCliExecutable(undefined, "zoo-test-cli", "Test")).resolves.toBe(
			path.join(directory, "zoo-test-cli"),
		)
	})

	it("uses a configured path and ignores surrounding spaces", async () => {
		const configured = `  ${path.join(directory, "zoo-test-cli")} `
		await expect(resolveCliExecutable(configured, "other", "Test")).resolves.toBe(
			path.join(directory, "zoo-test-cli"),
		)
	})

	it.each([
		["a configured path that is not executable", "not-executable"],
		["a configured path that does not exist", "missing"],
	])("rejects %s", async (_label, name) => {
		await expect(resolveCliExecutable(path.join(directory, name), "x", "Test")).rejects.toThrow(
			/Test executable not found at/,
		)
	})

	it("explains how to fix a CLI that is not installed", async () => {
		await expect(resolveCliExecutable(undefined, "zoo-no-such-cli-xyz", "Test")).rejects.toThrow(
			/"zoo-no-such-cli-xyz" was not found in PATH\. Install the Test CLI/,
		)
	})
})

describe("expandHomeDirectory", () => {
	it.each([
		["~", os.homedir()],
		["~/bin/muse", path.join(os.homedir(), "bin", "muse")],
		["/usr/bin/agy", "/usr/bin/agy"],
		["muse", "muse"],
	])("expands %s", (input, expected) => {
		expect(expandHomeDirectory(input)).toBe(expected)
	})
})
