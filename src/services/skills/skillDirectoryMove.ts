// Move skill directories across filesystems and restore the source if promotion fails.
// Extracted from SkillsManager.ts.

import * as fs from "fs/promises"
import * as path from "path"
import { t } from "../../i18n"

/**
 * Rename a directory, falling back to copy + delete across filesystems
 * (a skills directory may be a symlink to another device).
 *
 * The fallback never leaves the skill at two discoverable locations:
 * 1. Copy the source into a hidden staging dir next to destDir (dest filesystem),
 *    and check that no relative symlink in the copy points outside it.
 * 2. Atomically rename the source aside to a hidden trash dir (source filesystem).
 * 3. Atomically promote staging to destDir. On failure, restore the source from trash.
 * 4. Best-effort delete of the trash dir. The move is already committed, so a
 *    failure here is logged instead of thrown and never leaves a duplicate skill.
 *
 * Between steps 2 and 3 the skill is briefly not discoverable at all. Discovery and
 * the watchers skip the dot-prefixed staging and trash dirs.
 */
export async function moveSkillDirectory(sourceDir: string, destDir: string): Promise<void> {
	try {
		await fs.rename(sourceDir, destDir)
		return
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== "EXDEV") {
			throw error
		}
	}

	// A direct skill can itself be a symlink (e.g. .roo/skills/foo -> ../../shared/foo).
	// The tree copy below would copy the link itself with verbatimSymlinks, and the copied
	// link would resolve against a different parent and dangle. Move the link instead,
	// keeping it pointed at the same target.
	let sourceIsSymlink = false
	try {
		sourceIsSymlink = (await fs.lstat(sourceDir)).isSymbolicLink()
	} catch {
		// If the source can't be inspected, fall through to the copy path, which reports the error
	}
	if (sourceIsSymlink) {
		const target = await fs.readlink(sourceDir)
		// Resolve against the source's parent, since a relative target is relative to it
		const absoluteTarget = path.resolve(path.dirname(sourceDir), target)
		await fs.symlink(absoluteTarget, destDir, "dir")
		try {
			await fs.unlink(sourceDir)
		} catch (unlinkError) {
			// Never leave the skill linked at both locations
			await fs.unlink(destDir).catch((rollbackError) => {
				console.error(`Failed to remove ${destDir} after a failed symlink move:`, rollbackError)
			})
			throw unlinkError
		}
		return
	}

	const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
	const stagingDir = path.join(path.dirname(destDir), `.${path.basename(destDir)}.moving-${suffix}`)
	const trashDir = path.join(path.dirname(sourceDir), `.${path.basename(sourceDir)}.removing-${suffix}`)
	let sourceMovedAside = false

	try {
		// verbatimSymlinks: otherwise relative links get rewritten to point into the deleted source
		await fs.cp(sourceDir, stagingDir, {
			recursive: true,
			errorOnExist: true,
			force: false,
			verbatimSymlinks: true,
		})

		// A relative link that points outside the skill would dangle at the new
		// location. Fail now, while the source still exists.
		const escapingLink = await findEscapingRelativeSymlink(stagingDir)
		if (escapingLink) {
			throw new Error(
				t("skills:errors.symlink_escapes_skill", {
					link: path.join(sourceDir, path.relative(stagingDir, escapingLink)),
				}),
			)
		}

		const destExists = await fs.lstat(destDir).then(
			() => true,
			(error: NodeJS.ErrnoException) => {
				if (error?.code === "ENOENT") {
					return false
				}
				throw error
			},
		)
		if (destExists) {
			throw Object.assign(new Error(`Destination already exists: ${destDir}`), { code: "EEXIST" })
		}

		// Same parent directory, so this is atomic and cannot fail with EXDEV
		await fs.rename(sourceDir, trashDir)
		sourceMovedAside = true

		await fs.rename(stagingDir, destDir)
	} catch (moveError) {
		let restoreFailure: Error | undefined
		if (sourceMovedAside) {
			try {
				await fs.rename(trashDir, sourceDir)
			} catch (restoreError) {
				// Keep the trash dir so the original content is never lost
				console.error(
					`Failed to restore skill directory ${sourceDir} from ${trashDir} after a failed move:`,
					restoreError,
				)
				// The skill now only exists in the hidden trash dir, so tell the user where it is
				restoreFailure = new Error(
					t("skills:errors.move_restore_failed", {
						path: sourceDir,
						backupPath: trashDir,
						error: moveError instanceof Error ? moveError.message : String(moveError),
					}),
					{ cause: moveError },
				)
			}
		}
		await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
		throw restoreFailure ?? moveError
	}

	// The move is committed and the source is no longer discoverable under its
	// original name, so leftover trash must not turn a successful move into an error.
	try {
		await fs.rm(trashDir, { recursive: true, force: true })
	} catch (cleanupError) {
		console.error(`Failed to remove moved skill's old directory ${trashDir}:`, cleanupError)
	}
}

/**
 * Find a relative symlink under rootDir whose target resolves outside rootDir.
 * Absolute links keep working after a move, so they are allowed.
 * @returns The path of the first such link, or undefined if there is none
 */
async function findEscapingRelativeSymlink(rootDir: string): Promise<string | undefined> {
	const pending = [rootDir]
	while (pending.length > 0) {
		const dir = pending.pop()!
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const entryPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				pending.push(entryPath)
			} else if (entry.isSymbolicLink()) {
				const target = await fs.readlink(entryPath)
				if (path.isAbsolute(target)) continue
				const relativeToRoot = path.relative(rootDir, path.resolve(dir, target))
				if (relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`)) {
					return entryPath
				}
			}
		}
	}
	return undefined
}
