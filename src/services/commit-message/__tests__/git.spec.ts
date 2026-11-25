import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { prepareCommitIndex, readStagedCommitDiff, type AutoStage } from "../git"

let cwd: string
const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" })
const signal = new AbortController().signal

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "dory-commit-test-"))
	git("init", "-q")
})

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true })
})

const stagingCases: [AutoStage, boolean, string, boolean][] = [
	["never", false, "unstaged", false],
	["never", true, "ready", false],
	["if-empty", false, "ready", true],
	["if-empty", true, "ready", false],
	["always", true, "ready", true],
]

it.each(stagingCases)(
	"%s with pre-staged changes %s gives %s",
	async (mode, initiallyStaged, status, stagesOtherFile) => {
		await writeFile(join(cwd, "selected.txt"), "Selected content\n")
		if (initiallyStaged) git("add", "selected.txt")
		await writeFile(join(cwd, "other.txt"), "Other content\n")

		await expect(prepareCommitIndex("git", cwd, mode, signal)).resolves.toBe(status)
		const { patch } = await readStagedCommitDiff("git", cwd, signal)
		expect(patch.includes("Other content")).toBe(stagesOtherFile)
		expect(patch.includes("Selected content")).toBe(status === "ready")
		expect(git("status", "--short")).toContain(stagesOtherFile ? "A  other.txt" : "?? other.txt")
	},
)

it("bounds the prompt patch and detects a staged change beyond the limit", async () => {
	const contents = "+Long line of change content\n".repeat(1_000)
	const path = join(cwd, "large.txt")
	await writeFile(path, contents + "First ending\n")
	git("add", "large.txt")
	const before = await readStagedCommitDiff("git", cwd, signal)

	await writeFile(path, contents + "Other ending\n")
	git("add", "large.txt")
	const after = await readStagedCommitDiff("git", cwd, signal)

	expect(before.patch).toContain("[Remaining changes omitted]")
	expect(before.patch.length).toBeLessThan(24_100)
	// The blob ID in the Git header may also change.
	expect(before.fingerprint).not.toBe(after.fingerprint)
})
