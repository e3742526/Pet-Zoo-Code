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

it.each([
	{ mode: "never", expected: "unstaged", staged: false },
	{ mode: "if-empty", expected: "ready", staged: true },
] as const)("handles intent-to-add with auto-stage set to $mode", async ({ mode, expected, staged }) => {
	await writeFile(join(cwd, "intent.txt"), "Intent-to-add content\n")
	git("add", "-N", "intent.txt")

	await expect(prepareCommitIndex("git", cwd, mode, signal)).resolves.toBe(expected)
	const { patch } = await readStagedCommitDiff("git", cwd, signal)
	expect(patch.includes("Intent-to-add content")).toBe(staged)
	expect(git("diff", "--cached", "--name-only", "--ita-invisible-in-index").trim()).toBe(staged ? "intent.txt" : "")
})

it("leaves unmerged index entries alone when auto-stage is set to always", async () => {
	await writeFile(join(cwd, "conflict.txt"), "Conflict contents\n")
	const blob = git("hash-object", "-w", "conflict.txt").trim()
	execFileSync("git", ["update-index", "--index-info"], {
		cwd,
		input: `100644 ${blob} 2\tconflict.txt\n100644 ${blob} 3\tconflict.txt\n`,
	})
	const unmerged = git("ls-files", "--unmerged")
	expect(unmerged).not.toBe("")

	await expect(prepareCommitIndex("git", cwd, "always", signal)).resolves.toBe("conflicts")
	expect(git("ls-files", "--unmerged")).toBe(unmerged)
})

it.skipIf(process.platform === "win32")("handles tracked filenames that contain a newline", async () => {
	const name = "first line\nUU second line"
	await writeFile(join(cwd, name), "A normal file\n")
	git("add", name)

	await expect(prepareCommitIndex("git", cwd, "never", signal)).resolves.toBe("ready")
	const { patch } = await readStagedCommitDiff("git", cwd, signal)
	expect(patch).toContain("+A normal file")
})

it("changes the fingerprint when only the staged binary content changes", async () => {
	const binary = join(cwd, "binary")
	await writeFile(binary, Buffer.from([0, 1]))
	git("add", "binary")
	const before = await readStagedCommitDiff("git", cwd, signal)

	await writeFile(binary, Buffer.from([0, 2]))
	git("add", "binary")
	const after = await readStagedCommitDiff("git", cwd, signal)

	expect(before.patch).toContain("Binary files")
	expect(before.patch).toMatch(/^index [0-9a-f]{40,64}\.\.[0-9a-f]{40,64}$/m)
	expect(after.fingerprint).not.toBe(before.fingerprint)
})

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
