import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { promisify } from "node:util"

const execGit = promisify(execFile)
const GIT_TIMEOUT_MS = 15_000
/** Maximum number of diff bytes sent to the model. Larger diffs are truncated at a line boundary. */
const DIFF_LIMIT = 24_000
/** Two-letter `git status --porcelain=v1` codes for unmerged paths. */
const CONFLICT_STATES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])

/** The `commitMessage.autoStage` setting: when to run `git add -A` before drafting. */
export type AutoStage = "never" | "if-empty" | "always"

export type CommitIndexStatus = "clean" | "conflicts" | "unstaged" | "ready"

/**
 * Checks the working tree and stages changes as `autoStage` allows.
 * Returns `"ready"` only when the index holds changes to describe.
 */
export async function prepareCommitIndex(
	git: string,
	cwd: string,
	autoStage: AutoStage,
	signal: AbortSignal,
): Promise<CommitIndexStatus> {
	const options = { cwd, signal, timeout: GIT_TIMEOUT_MS, windowsHide: true }
	const { stdout } = await execGit(git, ["status", "--porcelain=v1", "--untracked-files=normal"], options)
	const states = [...stdout.matchAll(/^(.{2}) /gm)].map(([, state]) => state)
	if (states.length === 0) return "clean"
	if (states.some((state) => CONFLICT_STATES.has(state))) return "conflicts"

	// The first status column is the index. A space means unchanged, and "?" means untracked.
	const staged = states.some(([index]) => index !== " " && index !== "?")
	if (autoStage === "always" || (autoStage === "if-empty" && !staged)) {
		await execGit(git, ["add", "-A"], options)
		return "ready"
	}

	return staged ? "ready" : "unstaged"
}

/** Keep only a bounded patch for the prompt and fingerprint the full diff to detect changes during drafting. */
export function readStagedCommitDiff(
	git: string,
	cwd: string,
	signal: AbortSignal,
): Promise<{ patch: string; fingerprint: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(git, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3"], {
			cwd,
			signal: AbortSignal.any([signal, AbortSignal.timeout(GIT_TIMEOUT_MS)]),
			stdio: ["ignore", "pipe", "ignore"],
			windowsHide: true,
		})
		const buffer = Buffer.alloc(DIFF_LIMIT)
		let bytes = 0
		const hash = createHash("sha256")
		child.stdout.on("data", (chunk: Buffer) => {
			// Hash every byte, but copy only up to DIFF_LIMIT so a large diff does not grow memory.
			hash.update(chunk)
			if (bytes < DIFF_LIMIT) chunk.copy(buffer, bytes, 0, DIFF_LIMIT - bytes)
			bytes += chunk.length
		})
		child.on("error", reject)
		child.on("close", (exit) => {
			if (exit !== 0) {
				reject(new Error("Could not read the staged Git diff."))
				return
			}
			const prefix = buffer.toString("utf8", 0, Math.min(bytes, DIFF_LIMIT))
			const patch =
				bytes > DIFF_LIMIT
					? prefix.slice(0, Math.max(0, prefix.lastIndexOf("\n"))) + "\n[Remaining changes omitted]"
					: prefix
			resolve({ patch, fingerprint: hash.digest("hex") })
		})
	})
}
