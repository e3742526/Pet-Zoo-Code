import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import type { SimpleGit } from "simple-git"

import { safeWriteJson, SKIP_JSON_REPLACEMENT } from "../../utils/safeWriteJson"

const ignoreSnapshotTrailer = "Zoo-Checkpoint-Ignored-v1:"
const snapshotDirectory = "checkpoint-ignore-snapshots"

function computeSnapshotId(paths: string[]): string {
	return createHash("sha256").update(JSON.stringify(paths)).digest("hex")
}

/** Persist the ignore snapshot before publishing the commit that refers to it. */
export async function withCheckpointIgnoreSnapshot(git: SimpleGit, gitDir: string, message: string): Promise<string> {
	const output = await git.raw(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"])
	const ignoredPaths = output.split("\0").filter(Boolean).sort()
	const snapshotId = computeSnapshotId(ignoredPaths)
	const snapshotPath = path.join(gitDir, snapshotDirectory, `${snapshotId}.json`)

	await safeWriteJson(snapshotPath, ignoredPaths, {
		merge: (existing) =>
			isIgnoredPathList(existing) && computeSnapshotId(existing) === snapshotId
				? SKIP_JSON_REPLACEMENT
				: ignoredPaths,
	})

	return `${message}\n\n${ignoreSnapshotTrailer} ${snapshotId}`
}

export async function prepareCheckpointRestore(git: SimpleGit, gitDir: string, commitHash: string): Promise<void> {
	const ignoredPaths = await getCheckpointIgnoredPaths(git, gitDir, commitHash)

	// Git clean uses gitignore patterns. Anchor each path and escape pattern characters.
	const exclusions = ignoredPaths.map((filePath) => `--exclude=/${filePath.replace(/[\\*?[\] ]/g, "\\$&")}`)
	await git.clean("f", ["-d", "-f", ...exclusions])

	if (ignoredPaths.length > 0) {
		// A newer checkpoint can track a previously ignored file. Remove its shadow
		// index entry so the upcoming reset leaves the working file in place.
		await git.raw(["--literal-pathspecs", "rm", "--cached", "-r", "-f", "--ignore-unmatch", "--", ...ignoredPaths])
	}
}

async function getCheckpointIgnoredPaths(git: SimpleGit, gitDir: string, commitHash: string): Promise<string[]> {
	const message = await git.raw(["show", "-s", "--format=%B", "--end-of-options", commitHash])
	const trailer = message.trimEnd().split(/\r?\n/).at(-1)

	// Older checkpoint commits predate ignore snapshots.
	if (!trailer?.startsWith(ignoreSnapshotTrailer)) {
		return []
	}

	const snapshotId = trailer.slice(ignoreSnapshotTrailer.length).trim()
	if (!/^[a-f\d]{64}$/.test(snapshotId)) {
		throw new Error(`Invalid ignore snapshot ID for checkpoint ${commitHash}`)
	}

	const snapshotPath = path.join(gitDir, snapshotDirectory, `${snapshotId}.json`)
	const paths: unknown = JSON.parse(await fs.readFile(snapshotPath, "utf8"))
	if (!isIgnoredPathList(paths) || computeSnapshotId(paths) !== snapshotId) {
		throw new Error(`Invalid ignore snapshot for checkpoint ${commitHash}`)
	}

	return paths
}

function isIgnoredPathList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
}
