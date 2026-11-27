import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { copyFile, mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import * as vscode from "vscode"
import { z } from "zod"

import { RepoPerTaskCheckpointService } from "../../services/checkpoints/RepoPerTaskCheckpointService"
import { getTaskDirectoryPath } from "../../utils/storage"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { nativeEnvironment, type workspaceIdentity } from "./process"

const run = promisify(execFile)
const recoverySchema = z.object({ base: z.string().optional(), status: z.string() })

export async function captureRecoveryPoint(
	taskId: string,
	storage: string,
	workspace: Awaited<ReturnType<typeof workspaceIdentity>>,
) {
	const status = await workspace.git(["status", "--porcelain=v1", "--untracked-files=all"]).catch(() => "Unavailable")
	const file = path.join(await getTaskDirectoryPath(storage, taskId), "native_baseline.json")
	let base: string | undefined
	try {
		const service = RepoPerTaskCheckpointService.create({
			taskId,
			workspaceDir: workspace.root,
			shadowDir: storage,
			log: () => {},
		})
		service.once("initialize", (event) => {
			base = event.baseHash
		})
		await service.initShadowGit()
	} catch {
		// Git review remains available when the workspace cannot use a shadow repository.
	}
	await safeWriteJson(file, { base, status })
	return !!base
}

async function getRecoveryPoint(taskId: string, storage: string) {
	const directory = await getTaskDirectoryPath(storage, taskId)
	const recovery = recoverySchema.safeParse(
		JSON.parse(await readFile(path.join(directory, "native_baseline.json"), "utf8").catch(() => "{}")),
	)
	const base = recovery.success && /^[0-9a-f]{40,64}$/.test(recovery.data.base ?? "") ? recovery.data.base : undefined
	return {
		recovery: recovery.success ? recovery.data : undefined,
		base,
		gitDir: path.join(directory, "checkpoints", ".git"),
	}
}

export async function reviewWorkspace(
	taskId: string,
	storage: string,
	workspace: Awaited<ReturnType<typeof workspaceIdentity>>,
) {
	const { recovery, base, gitDir } = await getRecoveryPoint(taskId, storage)
	const [diff, status] = await Promise.all([
		workspace.git(["diff", "--no-ext-diff", "--no-textconv", "HEAD"]),
		workspace.git(["status", "--porcelain=v1", "--untracked-files=all"]),
	])
	const sinceStart = base
		? await run(
				"git",
				["--git-dir", gitDir, "--work-tree", workspace.root, "diff", "--no-ext-diff", "--no-textconv", base],
				{ env: nativeEnvironment(), timeout: 5000, maxBuffer: 1024 * 1024 },
			)
				.then(({ stdout }) => stdout)
				.catch(() => "Review against the saved snapshot is unavailable.")
		: undefined
	const document = await vscode.workspace.openTextDocument({
		language: "diff",
		content: [
			"Status before the first turn",
			recovery?.status || "(Clean or unavailable)",
			"Current status",
			status || "(Clean)",
			"Tracked changes against Git HEAD",
			diff,
			...(sinceStart === undefined ? [] : ["Changes to files captured in the recovery snapshot", sinceStart]),
		].join("\n\n"),
	})
	await vscode.window.showTextDocument(document, { preview: true })
}

export async function exportRecoveryPoint(
	taskId: string,
	storage: string,
	workspace: Awaited<ReturnType<typeof workspaceIdentity>>,
) {
	const { base, gitDir } = await getRecoveryPoint(taskId, storage)
	if (!base) throw new Error("This task has no saved file snapshot.")
	const target = await vscode.window.showSaveDialog({ filters: { "ZIP archive": ["zip"] } })
	if (!target) return
	if (target.scheme !== "file") throw new Error("Save the recovery archive to a local directory.")
	const targetParent = await realpath(path.dirname(target.fsPath))
	const relative = path.relative(workspace.root, targetParent)
	if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
		throw new Error("Save the recovery archive outside this checkout.")
	}
	const directory = await mkdtemp(path.join(tmpdir(), "dory-recovery-"))
	try {
		const zip = path.join(directory, "recovery.zip")
		await run("git", ["--git-dir", gitDir, "archive", "--format=zip", "--output=" + zip, base], {
			env: nativeEnvironment(),
			timeout: 30_000,
		})
		await copyFile(zip, target.fsPath, constants.COPYFILE_EXCL)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}
