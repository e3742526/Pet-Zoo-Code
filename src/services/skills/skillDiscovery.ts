// Scan skill directories and construct a discovery snapshot in precedence order.
// Extracted from SkillsManager.ts.

import * as fs from "fs/promises"
import * as path from "path"
import { parseFrontmatter } from "../../utils/safeFrontmatter"
import { directoryExists, fileExists } from "../roo-config"
import type { SkillMetadata } from "../../shared/skills"
import {
	validateSkillName as validateSkillNameShared,
	SkillNameValidationError,
	SKILL_NAME_MAX_LENGTH,
} from "@roo-code/types"
import { t } from "../../i18n"

/** Mutable state shared by every scan in a single discovery pass. */
export interface DiscoveryPass {
	/** Skills found in this pass. Published to the manager only when the pass ends. */
	skills: Map<string, SkillMetadata>
	/** SKILL.md paths of the skills found in this pass that come from a symlinked container. */
	containerSkillPaths: Set<string>
	/** Symlinked containers found in this pass: real path -> the root entry that links to it. */
	containers: Map<string, string>
	/**
	 * Paths that an unexpected error (anything except ENOENT/ENOTDIR) hid. Previously
	 * discovered skills and containers under them are kept, because they might only be
	 * unreadable for a moment. Everything else is replaced by the results of the pass.
	 */
	failedPaths: string[]
}

export function isNotFoundError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code
	return code === "ENOENT" || code === "ENOTDIR"
}

/**
 * Dot-prefixed entries are never valid skill names. They are also used for the
 * hidden staging and trash dirs of a cross-filesystem move.
 */
export function isHiddenEntry(name: string): boolean {
	return name.startsWith(".")
}

/**
 * Scan a skills directory for skill subdirectories.
 * Handles symlink cases:
 * 1. The skills directory itself is a symlink (resolved by directoryExists using realpath)
 * 2. Individual skill subdirectories are symlinks
 * 3. Symlinked container of skills (e.g., .roo/skills/shared -> /repo/skills).
 *    Only symlinks are treated as containers, and only one level deep.
 *
 * On name collisions the last loaded skill wins. Containers are loaded first
 * in reverse order, so direct skills win over container skills, and the
 * alphabetically first container wins over the others.
 *
 * Errors are handled per entry, so one unreadable entry never hides the rest of the root.
 */
export async function scanSkillsDirectory(
	dirPath: string,
	source: "global" | "project",
	mode: string | undefined,
	pass: DiscoveryPass,
	rootRealPaths: Map<string, string>,
): Promise<void> {
	let realDirPath = dirPath
	let entries: string[]
	try {
		if (!(await directoryExists(dirPath))) {
			return
		}
		// Get the real path (resolves if dirPath is a symlink)
		realDirPath = await fs.realpath(dirPath)
		// Sorted so collision handling doesn't depend on filesystem order
		entries = [...(await fs.readdir(realDirPath))].sort()
	} catch (error) {
		if (!isNotFoundError(error)) {
			pass.failedPaths.push(dirPath, realDirPath, rootRealPaths.get(dirPath) ?? realDirPath)
			console.error(`Failed to scan skills directory ${dirPath}:`, error)
		}
		return
	}
	rootRealPaths.set(dirPath, realDirPath)

	const directSkills: string[] = []
	const containerPaths: string[] = []

	for (const entryName of entries) {
		if (isHiddenEntry(entryName)) continue
		const entryPath = path.join(realDirPath, entryName)

		try {
			// Check if this entry is a directory (follows symlinks automatically)
			const stats = await fs.stat(entryPath)
			if (!stats.isDirectory()) continue

			if (await fileExists(path.join(entryPath, "SKILL.md"))) {
				directSkills.push(entryName)
			} else if (await isSymlink(entryPath, pass)) {
				containerPaths.push(entryPath)
			}
		} catch (error) {
			// A broken symlink (ENOENT) is simply not a skill
			if (!isNotFoundError(error)) {
				pass.failedPaths.push(entryPath)
				console.error(`Failed to check skill entry ${entryPath}:`, error)
			}
		}
	}

	for (const containerPath of containerPaths.reverse()) {
		await scanSkillContainer(containerPath, source, mode, pass)
	}

	for (const entryName of directSkills) {
		// The skill name comes from the entry name (symlink name if symlinked)
		await loadSkillMetadata(pass, path.join(realDirPath, entryName), source, mode, entryName)
	}
}

async function scanSkillContainer(
	containerPath: string,
	source: "global" | "project",
	mode: string | undefined,
	pass: DiscoveryPass,
): Promise<void> {
	let realContainerPath = containerPath
	try {
		realContainerPath = await fs.realpath(containerPath)
		pass.containers.set(realContainerPath, containerPath)

		const entries = [...(await fs.readdir(realContainerPath))].sort()
		for (const entryName of entries) {
			if (isHiddenEntry(entryName)) continue
			const entryPath = path.join(realContainerPath, entryName)

			let isDirectory = false
			try {
				isDirectory = (await fs.stat(entryPath)).isDirectory()
			} catch (error) {
				// A broken symlink (ENOENT) is simply not a skill
				if (!isNotFoundError(error)) {
					pass.failedPaths.push(entryPath)
					console.error(`Failed to stat skill entry ${entryPath} in container ${containerPath}:`, error)
				}
			}
			if (!isDirectory) continue

			const skillMdPath = await loadSkillMetadata(pass, entryPath, source, mode, entryName)
			if (skillMdPath) {
				pass.containerSkillPaths.add(skillMdPath)
			}
		}
	} catch (error) {
		if (!isNotFoundError(error)) {
			pass.failedPaths.push(containerPath, realContainerPath)
			console.error(`Failed to scan skills container ${containerPath}:`, error)
		}
	}
}

/**
 * @param pass - When called during discovery, an unexpected error marks the entry
 * as failed, since it might be a container that is only unreadable for a moment.
 */
export async function isSymlink(entryPath: string, pass?: DiscoveryPass): Promise<boolean> {
	try {
		return (await fs.lstat(entryPath)).isSymbolicLink()
	} catch (error) {
		if (!isNotFoundError(error)) {
			pass?.failedPaths.push(entryPath)
			console.error(`Failed to check whether ${entryPath} is a symlink:`, error)
		}
		return false
	}
}

/**
 * Load skill metadata from a skill directory.
 * @param pass - The discovery pass that collects the loaded skill
 * @param skillDir - The resolved path to the skill directory (target of symlink if symlinked)
 * @param source - Whether this is a global or project skill
 * @param mode - The mode this skill is specific to (undefined for generic skills)
 * @param skillName - The skill name (from symlink name if symlinked, otherwise from directory name)
 * @returns The SKILL.md path if the skill was loaded, otherwise undefined
 */
async function loadSkillMetadata(
	pass: DiscoveryPass,
	skillDir: string,
	source: "global" | "project",
	mode?: string,
	skillName?: string,
): Promise<string | undefined> {
	const skillMdPath = path.join(skillDir, "SKILL.md")

	let fileContent: string
	try {
		if (!(await fileExists(skillMdPath))) return undefined
		fileContent = await fs.readFile(skillMdPath, "utf-8")
	} catch (error) {
		// An unreadable SKILL.md may only be unreadable for a moment, so keep the
		// previously discovered skill. A file removed mid-scan is simply gone.
		if (!isNotFoundError(error)) {
			pass.failedPaths.push(skillDir)
			console.error(`Failed to read skill at ${skillDir}:`, error)
		}
		return undefined
	}

	try {
		// Use gray-matter to parse frontmatter
		const { data: frontmatter } = parseFrontmatter(fileContent)

		// Validate required fields (only name and description for now)
		if (!frontmatter.name || typeof frontmatter.name !== "string") {
			console.error(`Skill at ${skillDir} is missing required 'name' field`)
			return
		}
		if (!frontmatter.description || typeof frontmatter.description !== "string") {
			console.error(`Skill at ${skillDir} is missing required 'description' field`)
			return
		}

		// Validate that frontmatter name matches the skill name (directory name or symlink name)
		// Per the Agent Skills spec: "name field must match the parent directory name"
		const effectiveSkillName = skillName || path.basename(skillDir)
		if (frontmatter.name !== effectiveSkillName) {
			console.error(`Skill name "${frontmatter.name}" doesn't match directory "${effectiveSkillName}"`)
			return
		}

		// Validate skill name per agentskills.io spec using shared validation
		const nameValidation = validateSkillNameShared(effectiveSkillName)
		if (!nameValidation.valid) {
			const errorMessage = getSkillNameErrorMessage(effectiveSkillName, nameValidation.error!)
			console.error(`Skill name "${effectiveSkillName}" is invalid: ${errorMessage}`)
			return
		}

		// Description constraints:
		// - 1-1024 chars
		// - non-empty (after trimming)
		const description = frontmatter.description.trim()
		if (description.length < 1 || description.length > 1024) {
			console.error(
				`Skill "${effectiveSkillName}" has an invalid description length: must be 1-1024 characters (got ${description.length})`,
			)
			return
		}

		// Parse modeSlugs from frontmatter (new format) or fall back to directory-based mode
		// Priority: frontmatter.modeSlugs > frontmatter.mode > directory mode
		let modeSlugs: string[] | undefined
		if (Array.isArray(frontmatter.modeSlugs)) {
			modeSlugs = frontmatter.modeSlugs.filter((s: unknown) => typeof s === "string" && s.length > 0)
			if (modeSlugs.length === 0) {
				modeSlugs = undefined // Empty array means "any mode"
			}
		} else if (typeof frontmatter.mode === "string" && frontmatter.mode.length > 0) {
			// Legacy single mode in frontmatter
			modeSlugs = [frontmatter.mode]
		} else if (mode) {
			// Fall back to directory-based mode (skills-{mode}/)
			modeSlugs = [mode]
		}

		// Create unique key combining name, source, and modeSlugs for override resolution
		// For backward compatibility, use first mode slug or undefined for the key
		const primaryMode = modeSlugs?.[0]
		const skillKey = getSkillKey(effectiveSkillName, source, primaryMode)

		pass.skills.set(skillKey, {
			name: effectiveSkillName,
			description,
			path: skillMdPath,
			source,
			mode: primaryMode, // Deprecated: kept for backward compatibility
			modeSlugs, // New: array of mode slugs, undefined = any mode
		})
		return skillMdPath
	} catch (error) {
		console.error(`Failed to load skill at ${skillDir}:`, error)
		return undefined
	}
}

export function getSkillKey(name: string, source: string, mode?: string): string {
	return `${source}:${mode || "generic"}:${name}`
}

/**
 * Convert skill name validation error code to a user-friendly error message.
 */
export function getSkillNameErrorMessage(name: string, error: SkillNameValidationError): string {
	switch (error) {
		case SkillNameValidationError.Empty:
			return t("skills:errors.name_length", { maxLength: SKILL_NAME_MAX_LENGTH, length: name.length })
		case SkillNameValidationError.TooLong:
			return t("skills:errors.name_length", { maxLength: SKILL_NAME_MAX_LENGTH, length: name.length })
		case SkillNameValidationError.InvalidFormat:
			return t("skills:errors.name_format")
	}
}
