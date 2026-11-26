// Persist and validate the guarded repair intent used during task history startup recovery.
// Extracted from TaskHistoryStore.ts.

import * as fs from "fs/promises"
import * as path from "path"

import type { HistoryItem } from "@roo-code/types"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { deleteJsonFile } from "../../utils/jsonFileRecovery"
import { readFileWithMissingRetry } from "./readFileWithMissingRetry"

/**
 * Durable intent for the one repair that spans an active delegated child and
 * its parent. Task files remain authoritative; this file only records the
 * guarded target transition that must be completed after a crash.
 */
export interface DelegationRepairIntent {
	version: 1
	operationId: string
	parentTaskId: string
	childTaskId: string
	expected: {
		parent: {
			status: "delegated"
			awaitingChildId: string
			delegatedToId?: string
		}
		child: {
			status: "active"
			parentTaskId?: string
			rootTaskId?: string
			attemptGeneration?: number
		}
	}
	target: {
		childStatus: "interrupted"
		parentStatus: "active"
	}
}

export function matchesDelegationRepairParentPreconditions(
	intent: DelegationRepairIntent,
	parent: HistoryItem,
): boolean {
	return (
		parent.status === intent.expected.parent.status &&
		parent.awaitingChildId === intent.expected.parent.awaitingChildId &&
		parent.delegatedToId === intent.expected.parent.delegatedToId
	)
}

export function matchesDelegationRepairChildPreconditions(
	intent: DelegationRepairIntent,
	child: HistoryItem,
	status: "active" | "interrupted" = intent.expected.child.status,
): boolean {
	return (
		(child.status ?? "active") === status &&
		child.parentTaskId === intent.expected.child.parentTaskId &&
		child.rootTaskId === intent.expected.child.rootTaskId &&
		(child.attemptGeneration ?? 0) === (intent.expected.child.attemptGeneration ?? 0) &&
		child.detachedFromParentId !== intent.parentTaskId
	)
}

function isFileNotFoundError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

export class DelegationRepairJournal {
	constructor(private readonly getTasksDir: () => Promise<string>) {}

	async read(): Promise<DelegationRepairIntent | null> {
		const intentPath = await this.getDelegationRepairIntentPath()
		let parsed: unknown
		try {
			parsed = JSON.parse(await readFileWithMissingRetry(intentPath)) as unknown
		} catch (error) {
			if (isFileNotFoundError(error)) {
				return null
			}
			await this.quarantine(null, "malformed JSON")
			return null
		}

		if (!this.isDelegationRepairIntent(parsed)) {
			await this.quarantine(null, "malformed intent")
			return null
		}
		return parsed
	}

	private isDelegationRepairIntent(value: unknown): value is DelegationRepairIntent {
		if (!value || typeof value !== "object") {
			return false
		}
		const candidate = value as Record<string, unknown>
		const expected = candidate.expected
		const expectedRecord = expected && typeof expected === "object" ? (expected as Record<string, unknown>) : null
		const expectedParent =
			expectedRecord?.parent && typeof expectedRecord.parent === "object"
				? (expectedRecord.parent as Record<string, unknown>)
				: null
		const expectedChild =
			expectedRecord?.child && typeof expectedRecord.child === "object"
				? (expectedRecord.child as Record<string, unknown>)
				: null
		const target = candidate.target
		const targetRecord = target && typeof target === "object" ? (target as Record<string, unknown>) : null
		return (
			candidate.version === 1 &&
			typeof candidate.operationId === "string" &&
			this.isSafeTaskId(candidate.parentTaskId) &&
			this.isSafeTaskId(candidate.childTaskId) &&
			candidate.parentTaskId !== candidate.childTaskId &&
			!!expectedParent &&
			expectedParent.status === "delegated" &&
			typeof expectedParent.awaitingChildId === "string" &&
			expectedParent.awaitingChildId === candidate.childTaskId &&
			(expectedParent.delegatedToId === undefined || typeof expectedParent.delegatedToId === "string") &&
			!!expectedChild &&
			expectedChild.status === "active" &&
			(expectedChild.parentTaskId === undefined || typeof expectedChild.parentTaskId === "string") &&
			(expectedChild.rootTaskId === undefined || typeof expectedChild.rootTaskId === "string") &&
			(expectedChild.attemptGeneration === undefined ||
				(typeof expectedChild.attemptGeneration === "number" &&
					Number.isSafeInteger(expectedChild.attemptGeneration) &&
					expectedChild.attemptGeneration >= 0)) &&
			!!targetRecord &&
			targetRecord.childStatus === "interrupted" &&
			targetRecord.parentStatus === "active"
		)
	}

	async write(intent: DelegationRepairIntent): Promise<void> {
		await safeWriteJson(await this.getDelegationRepairIntentPath(), intent)
	}

	async remove(): Promise<void> {
		try {
			await deleteJsonFile(await this.getDelegationRepairIntentPath())
		} catch (error) {
			console.warn("[TaskHistoryStore] Failed to remove completed delegation repair intent:", error)
		}
	}

	async quarantine(intent: DelegationRepairIntent | null, reason: string): Promise<void> {
		const intentPath = await this.getDelegationRepairIntentPath()
		const quarantinePath = `${intentPath}.quarantine-${Date.now()}-${Math.random().toString(36).slice(2)}`
		try {
			await fs.rename(intentPath, quarantinePath)
		} catch (error) {
			console.warn("[TaskHistoryStore] Failed to quarantine delegation repair intent:", error)
		}
		console.warn(
			`[TaskHistoryStore] Ignored ${intent ? `stale delegation repair intent ${intent.operationId}` : "malformed delegation repair intent"}: ${reason}`,
		)
	}

	private isSafeTaskId(value: unknown): value is string {
		return (
			typeof value === "string" &&
			value.length > 0 &&
			value !== "." &&
			value !== ".." &&
			!value.includes("/") &&
			!value.includes("\\")
		)
	}

	private async getDelegationRepairIntentPath(): Promise<string> {
		const tasksDir = await this.getTasksDir()
		return path.join(tasksDir, GlobalFileNames.delegationRepairIntent)
	}
}
