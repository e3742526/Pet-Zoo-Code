import * as fs from "fs/promises"
import * as path from "path"

import { getSembleBinaryPath } from "../semble-binary"

vi.mock("fs/promises", () => ({ access: vi.fn(), readFile: vi.fn() }))

describe("local Semble installation", () => {
	const originalPlatform = process.platform
	const originalArch = process.arch

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform })
		Object.defineProperty(process, "arch", { value: originalArch })
		vi.resetAllMocks()
	})

	it.each([
		["linux", "x64", "semble"],
		["win32", "x64", "semble.exe"],
	])("uses the complete saved installation on %s %s", async (platform, arch, executable) => {
		Object.defineProperty(process, "platform", { value: platform })
		Object.defineProperty(process, "arch", { value: arch })
		vi.mocked(fs.readFile).mockResolvedValue("v0.4.1\n")
		vi.mocked(fs.access).mockResolvedValue(undefined)

		await expect(getSembleBinaryPath("/storage")).resolves.toBe(path.join("/storage", "semble", executable))
	})

	it.each(["missing binary", "different version", "unsupported platform"])("ignores a %s", async (reason) => {
		Object.defineProperty(process, "platform", { value: reason === "unsupported platform" ? "freebsd" : "linux" })
		Object.defineProperty(process, "arch", { value: "x64" })
		vi.mocked(fs.readFile).mockResolvedValue(reason === "different version" ? "v0.4.0" : "v0.4.1")
		vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"))

		await expect(getSembleBinaryPath("/storage")).resolves.toBeUndefined()
		if (reason !== "missing binary") expect(fs.access).not.toHaveBeenCalled()
	})
})
