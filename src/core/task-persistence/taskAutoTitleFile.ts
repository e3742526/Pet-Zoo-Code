// Read and update the stored title under the per-file lock.
// Extracted from TaskHistoryStore.ts.

import type { HistoryItem } from "@roo-code/types"

import { safeWriteJson } from "../../utils/safeWriteJson"
import { getErrorCode, readFileWithMissingRetry } from "./readFileWithMissingRetry"

export type AutoTitleDiskRead = { kind: "found"; item: HistoryItem } | { kind: "missing" } | { kind: "unreadable" }

export async function readTaskFileForAutoTitle(
	taskId: string,
	getFilePath: () => Promise<string>,
): Promise<AutoTitleDiskRead> {
	let raw: string
	try {
		raw = await readFileWithMissingRetry(await getFilePath())
	} catch (error) {
		if (getErrorCode(error) === "ENOENT") {
			return { kind: "missing" }
		}
		return unreadableForAutoTitle(taskId, error)
	}
	try {
		const item: unknown = JSON.parse(raw)
		const id = typeof item === "object" && item !== null ? (item as { id?: unknown }).id : undefined
		if (id !== taskId) {
			return unreadableForAutoTitle(taskId, `task file has id ${JSON.stringify(id)}`)
		}
		return { kind: "found", item: item as HistoryItem }
	} catch (error) {
		return unreadableForAutoTitle(taskId, error)
	}
}

/** The caller only sees `applied: false`, so the reason is logged here. */
function unreadableForAutoTitle(taskId: string, reason: unknown): AutoTitleDiskRead {
	console.warn(`[TaskHistoryStore] Failed to read task ${taskId} for auto title:`, reason)
	return { kind: "unreadable" }
}

export async function writeAutoTitleIfAbsent(
	taskId: string,
	item: HistoryItem,
	title: string,
	getFilePath: () => Promise<string>,
): Promise<{ kind: "skipped" } | { kind: "written"; item: HistoryItem | undefined }> {
	const skipped = Symbol("auto-title-skipped")
	let persisted: HistoryItem | undefined
	try {
		const filePath = await getFilePath()
		await safeWriteJson(
			filePath,
			{ ...item, autoTitle: title },
			{
				merge: (existing) => {
					const current = existing as Partial<HistoryItem> | null
					if (!current || current.id !== taskId || current.autoTitle) {
						throw Object.assign(new Error("auto title skipped"), { [skipped]: true })
					}
					persisted = { ...(current as HistoryItem), autoTitle: title }
					return persisted
				},
			},
		)
	} catch (error) {
		if (!(error instanceof Error) || !(skipped in error)) {
			throw error
		}
		// safeWriteJson reports both a missing and an unparsable file as `null`, so re-read to tell them apart.
		return { kind: "skipped" }
	}
	return { kind: "written", item: persisted }
}
