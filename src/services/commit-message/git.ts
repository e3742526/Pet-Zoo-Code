import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { promisify } from "node:util"

const execGit = promisify(execFile)
const GIT_TIMEOUT_MS = 15_000
const DIFF_LIMIT = 24_000

export type AutoStage = "never" | "if-empty" | "always"

export async function prepareCommitIndex(git: string, cwd: string, autoStage: AutoStage, signal: AbortSignal) {
	const options = { cwd, signal, timeout: GIT_TIMEOUT_MS, windowsHide: true }
	const { stdout } = await execGit(git, ["status", "--porcelain=v1", "--untracked-files=normal"], options)
	const states = [...stdout.matchAll(/^(.{2}) /gm)].map((match) => match[1])
	if (states.length === 0) return "clean"
	if (states.some((state) => /^(DD|AU|UD|UA|DU|AA|UU)$/.test(state))) return "conflicts"

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
