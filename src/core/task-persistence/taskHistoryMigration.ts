// Migrate legacy history entries into their existing task directories.
// Extracted from TaskHistoryStore.ts.

import * as fs from "fs/promises"
import * as path from "path"

import { historyItemSchema, type HistoryItem } from "@roo-code/types"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { getErrorCode } from "./readFileWithMissingRetry"

/** The caller holds the task history store lock. */
export async function migrateTaskFilesLocked(
	tasksDir: string,
	taskHistoryEntries: HistoryItem[],
	cache: Map<string, HistoryItem>,
): Promise<void> {
	for (const item of taskHistoryEntries) {
		if (!item.id) {
			continue
		}

		// Check if task directory exists on disk
		const taskDir = path.join(tasksDir, item.id)

		try {
			await fs.access(taskDir)
		} catch {
			// Task directory doesn't exist; skip this entry as it's orphaned in globalState
			continue
		}

		// Write history_item.json if it doesn't exist yet
		const filePath = path.join(taskDir, GlobalFileNames.historyItem)
		try {
			await fs.access(filePath)
			// File already exists, skip (don't overwrite existing per-task files)
		} catch (error) {
			if (getErrorCode(error) !== "ENOENT") throw error
			// Recovery or a peer may supply a committed record after the access check.
			let persisted = item
			await safeWriteJson(filePath, item, {
				merge: (existing) => {
					if (existing !== null) {
						const recovered = historyItemSchema.parse(existing)
						if (recovered.id !== item.id) throw new Error("Migration task ID mismatch")
						persisted = recovered
					}
					return persisted
				},
			})
			cache.set(item.id, persisted)
		}
	}
}
