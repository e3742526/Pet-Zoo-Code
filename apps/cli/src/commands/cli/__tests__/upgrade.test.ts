import { ChildProcess } from "node:child_process"

import { compareVersions, getLatestCliVersion, runUpgradeInstaller, upgrade } from "../upgrade.js"

function createFetchResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
	const { ok = true, status = 200 } = init
	return {
		ok,
		status,
		json: async () => body,
	} as Response
}

describe("compareVersions", () => {
	it("returns 1 when first version is newer", () => {
		expect(compareVersions("0.2.0", "0.1.9")).toBe(1)
	})

	it("returns -1 when first version is older", () => {
		expect(compareVersions("0.1.4", "0.1.5")).toBe(-1)
	})

	it("returns 0 when versions are equivalent", () => {
		expect(compareVersions("v1.2.0", "1.2")).toBe(0)
	})

	it("supports cli tag prefixes and prerelease metadata", () => {
		expect(compareVersions("cli-v1.2.3", "1.2.2")).toBe(1)
		expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0)
	})

	it("compares multi-digit patch versions numerically", () => {
		expect(compareVersions("0.1.10", "0.1.9")).toBe(1)
	})
})

describe("getLatestCliVersion", () => {
	it("returns the highest cli-v release tag from Pet-Zoo-Code releases", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				createFetchResponse([
					{ tag_name: "cli-v0.1.9" },
					{ tag_name: "v9.9.9" },
					{ tag_name: "cli-v0.1.10" },
					{ tag_name: "cli-v0.1.8" },
				]),
			)

		await expect(getLatestCliVersion(fetchImpl)).resolves.toBe("0.1.10")
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://api.github.com/repos/e3742526/Pet-Zoo-Code/releases?per_page=100",
			expect.any(Object),
		)
	})

	it("throws when release check fails", async () => {
		const fetchImpl = (async () => createFetchResponse({}, { ok: false, status: 503 })) as typeof fetch

		await expect(getLatestCliVersion(fetchImpl)).rejects.toThrow("Failed to check latest version")
	})
})

describe("runUpgradeInstaller", () => {
	it("downloads the Pet-Zoo-Code installer for the selected version", async () => {
		const child = new ChildProcess()
		const spawnImpl = vi.fn<NonNullable<Parameters<typeof runUpgradeInstaller>[1]>>().mockReturnValue(child)
		const result = runUpgradeInstaller("0.2.0", spawnImpl)
		child.emit("close", 0, null)

		await expect(result).resolves.toBeUndefined()
		expect(spawnImpl).toHaveBeenCalledOnce()
		const call = spawnImpl.mock.lastCall
		expect(call?.[0]).toBe("sh")
		expect(call?.[1]).toEqual([
			"-c",
			expect.stringContaining("https://raw.githubusercontent.com/e3742526/Pet-Zoo-Code/main/apps/cli/install.sh"),
		])
		expect(call?.[2].env?.ROO_VERSION).toBe("0.2.0")
	})
})

describe("upgrade", () => {
	let logSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
	})

	afterEach(() => {
		logSpy.mockRestore()
	})

	it("does not run installer when already up to date", async () => {
		const runInstaller = vi.fn(async () => undefined)
		const fetchImpl = (async () => createFetchResponse([{ tag_name: "cli-v0.1.4" }])) as typeof fetch

		await upgrade({
			currentVersion: "0.1.4",
			fetchImpl,
			runInstaller,
		})

		expect(runInstaller).not.toHaveBeenCalled()
		expect(logSpy).toHaveBeenCalledWith("Dory Code CLI is already up to date.")
	})

	it("runs installer when a newer version is available", async () => {
		const runInstaller = vi.fn(async () => undefined)
		const fetchImpl = (async () => createFetchResponse([{ tag_name: "cli-v0.2.0" }])) as typeof fetch

		await upgrade({
			currentVersion: "0.1.4",
			fetchImpl,
			runInstaller,
		})

		expect(runInstaller).toHaveBeenCalledTimes(1)
		expect(logSpy).toHaveBeenCalledWith("✓ Upgrade completed.")
	})

	it("leaves the installation in place when the fork has no CLI release", async () => {
		const runInstaller = vi.fn(async () => undefined)
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createFetchResponse([{ tag_name: "v3.98.2" }]))

		await expect(upgrade({ currentVersion: "0.1.4", fetchImpl, runInstaller })).rejects.toThrow(
			"No CLI release is available for Dory Code.",
		)
		expect(runInstaller).not.toHaveBeenCalled()
	})
})
