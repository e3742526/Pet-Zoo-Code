import fs from "fs/promises"
import path from "path"

import { promptShortcutsSchema, type PromptShortcut } from "@roo-code/types"

import { getProjectRooDirectoryForCwd } from "../../services/roo-config"
import { getErrorCode } from "../../utils/errorCode"
import { safeWriteJson } from "../../utils/safeWriteJson"

const shortcutsPath = (cwd: string) => path.join(getProjectRooDirectoryForCwd(cwd), "prompt-shortcuts.json")

export async function loadPromptShortcuts(cwd: string | undefined): Promise<PromptShortcut[]> {
	if (!cwd) return []
	try {
		return promptShortcutsSchema.parse(JSON.parse(await fs.readFile(shortcutsPath(cwd), "utf8")))
	} catch (error) {
		if (getErrorCode(error) === "ENOENT") return []
		throw error
	}
}

export async function savePromptShortcuts(cwd: string, shortcuts: unknown): Promise<void> {
	if (!cwd) throw new Error("Open a repository before you save prompts.")
	const validated = promptShortcutsSchema.parse(shortcuts)
	await safeWriteJson(shortcutsPath(cwd), validated, { prettyPrint: true })
}
