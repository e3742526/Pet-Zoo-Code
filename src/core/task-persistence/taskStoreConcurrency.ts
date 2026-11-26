import deepEqual from "fast-deep-equal"
import { historyItemSchema, type HistoryItem } from "@roo-code/types"

import { type HistoryItemStatus, VALID_TASK_STATUS_TRANSITIONS } from "./taskLifecycle"

export class DeltaRejectedError extends Error {
	constructor(
		public readonly taskId: string,
		public readonly diskStatus: HistoryItemStatus,
		public readonly attemptedStatus: HistoryItemStatus,
	) {
		super(`Delta rejected for task ${taskId}: disk status ${diskStatus} rejects transition to ${attemptedStatus}`)
		this.name = "DeltaRejectedError"
	}
}

export interface HistoryWriteGuard {
	awaitedChild?: { id: string | undefined }
	pendingActionId?: string
	attemptGeneration?: number
	status?: HistoryItemStatus
	parentLink?: string
	unfinished?: boolean
}

export class HistoryOwnershipError extends Error {
	constructor(
		public readonly taskId: string,
		public readonly awaitedChildId?: string,
	) {
		super(`Task ${taskId} changed before the lifecycle write (awaited child: ${awaitedChildId ?? "none"})`)
		this.name = "HistoryOwnershipError"
	}
}

export function requireHistoryRecord(existing: unknown, id: string): HistoryItem {
	const parsed = historyItemSchema.safeParse(existing)
	if (!parsed.success || parsed.data.id !== id) throw new HistoryOwnershipError(id)
	return existing as HistoryItem
}

// Existing records take only message-derived fields from a live Task snapshot.
export function messageHistoryFields(item: HistoryItem) {
	const { ts, task, tokensIn, tokensOut, cacheWrites, cacheReads, totalCost, size } = item
	return { ts, task, tokensIn, tokensOut, cacheWrites, cacheReads, totalCost, size }
}

export function computeHistoryDelta(cached: HistoryItem, incoming: Partial<HistoryItem>): Partial<HistoryItem> {
	return Object.fromEntries(
		Object.entries(incoming).filter(([key, value]) => !deepEqual(value, (cached as Record<string, unknown>)[key])),
	) as Partial<HistoryItem>
}

export function mergeHistoryDelta(
	existing: unknown,
	incoming: HistoryItem,
	delta: Partial<HistoryItem>,
	guard?: HistoryWriteGuard,
): HistoryItem {
	if (guard) {
		const disk = requireHistoryRecord(existing, incoming.id)
		if (
			(guard.awaitedChild && disk.awaitingChildId !== guard.awaitedChild.id) ||
			(guard.pendingActionId !== undefined && disk.pendingAction?.actionId !== guard.pendingActionId) ||
			(guard.attemptGeneration !== undefined && (disk.attemptGeneration ?? 0) !== guard.attemptGeneration) ||
			(guard.status !== undefined && (disk.status ?? "active") !== guard.status) ||
			(guard.parentLink !== undefined && disk.parentTaskId !== guard.parentLink) ||
			(guard.unfinished && disk.status === "completed")
		) {
			throw new HistoryOwnershipError(disk.id, disk.awaitingChildId)
		}
	}
	if (!existing || typeof existing !== "object" || !("id" in existing)) {
		return incoming
	}
	const disk = existing as HistoryItem
	const normalizedDelta = { ...delta }
	if ("status" in delta) {
		const diskStatus: HistoryItemStatus = disk.status ?? "active"
		const attemptedStatus: HistoryItemStatus = delta.status ?? "active"
		if (attemptedStatus !== diskStatus) {
			const validTargets = VALID_TASK_STATUS_TRANSITIONS[diskStatus]
			if (!validTargets.includes(attemptedStatus)) {
				throw new DeltaRejectedError(disk.id, diskStatus, attemptedStatus)
			}
		}
		normalizedDelta.status = attemptedStatus
	}
	const merged = { ...disk, ...normalizedDelta }
	if (normalizedDelta.childIds && disk.childIds) {
		merged.childIds = [...new Set([...disk.childIds, ...normalizedDelta.childIds])]
	}
	return merged
}
