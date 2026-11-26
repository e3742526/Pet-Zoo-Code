type MessageRecord = Record<string, unknown> & { messageId?: unknown; ts?: unknown }
type IdentifiedMessage = { messageId?: string; ts?: unknown }

function isRecord(value: unknown): value is MessageRecord {
	return typeof value === "object" && value !== null
}

export function ensureMessageIdentifiers<T extends IdentifiedMessage>(messages: T[]): T[] {
	// Pre-scan: collect all IDs already present so generated ones stay unique.
	const usedIds = new Set<string>()
	for (const message of messages) {
		if (typeof message.messageId === "string") usedIds.add(message.messageId)
	}

	const timestampOrdinals = new Map<string, number>()
	for (const message of messages) {
		if (typeof message.messageId === "string") continue

		const timestampKey = typeof message.ts === "number" ? String(message.ts) : "none"
		let ordinal = timestampOrdinals.get(timestampKey) ?? 0
		let candidate = `legacy:${timestampKey}:${ordinal}`
		while (usedIds.has(candidate)) {
			ordinal++
			candidate = `legacy:${timestampKey}:${ordinal}`
		}
		timestampOrdinals.set(timestampKey, ordinal + 1)
		usedIds.add(candidate)
		message.messageId = candidate
	}
	return messages
}

function mergeTimestampedSnapshots(
	existing: unknown,
	incoming: unknown,
	mergeMatch?: (disk: MessageRecord, next: MessageRecord) => MessageRecord,
): unknown {
	if (!Array.isArray(existing) || !Array.isArray(incoming)) {
		return incoming
	}

	const existingGroups = new Map<number, (MessageRecord | undefined)[]>()
	const existingLegacy: unknown[] = []

	for (const message of existing) {
		if (isRecord(message) && typeof message.ts === "number") {
			const group = existingGroups.get(message.ts) ?? []
			group.push(message)
			existingGroups.set(message.ts, group)
		} else {
			existingLegacy.push(message)
		}
	}

	let incomingLegacyCount = 0
	const merged = incoming.map((message) => {
		if (!isRecord(message) || typeof message.ts !== "number") {
			incomingLegacyCount++
			return message
		}

		const existingGroup = existingGroups.get(message.ts)
		if (!existingGroup) return message
		const messageId = typeof message.messageId === "string" ? message.messageId : undefined
		let diskIndex = existingGroup.findIndex((candidate) => candidate && candidate.messageId === messageId)
		if (diskIndex === -1 && messageId !== undefined) {
			// Match one legacy record while persisted histories are upgraded with identifiers.
			diskIndex = existingGroup.findIndex((candidate) => candidate && candidate.messageId === undefined)
		}
		const diskMessage = diskIndex === -1 ? undefined : existingGroup[diskIndex]
		if (diskMessage !== undefined) {
			// Clear a consumed slot without shifting equal-timestamp siblings.
			existingGroup[diskIndex] = undefined
			if (mergeMatch !== undefined) return mergeMatch(diskMessage, message)
		}
		return message
	})

	const diskOnlyTimestamped: MessageRecord[] = []
	for (const messages of existingGroups.values()) {
		for (const message of messages) {
			if (message !== undefined) diskOnlyTimestamped.push(message)
		}
	}

	const timestampMerged: unknown[] = []
	let diskOnlyIndex = 0
	for (const incomingMessage of merged) {
		if (isRecord(incomingMessage) && typeof incomingMessage.ts === "number") {
			while (
				diskOnlyIndex < diskOnlyTimestamped.length &&
				(diskOnlyTimestamped[diskOnlyIndex].ts as number) < incomingMessage.ts
			) {
				timestampMerged.push(diskOnlyTimestamped[diskOnlyIndex])
				diskOnlyIndex++
			}
		}
		timestampMerged.push(incomingMessage)
	}
	timestampMerged.push(...diskOnlyTimestamped.slice(diskOnlyIndex))

	timestampMerged.push(...existingLegacy.slice(incomingLegacyCount))
	return timestampMerged
}

export function mergeClineMessageSnapshots(existing: unknown, incoming: unknown): unknown {
	return mergeTimestampedSnapshots(existing, incoming, (disk, next) => {
		if (disk.type !== next.type || disk.say !== next.say || disk.ask !== next.ask) {
			return next
		}

		if (disk.partial !== true && next.partial === true) {
			return disk
		}
		const merged = { ...disk, ...next }
		if (disk.isAnswered === true) {
			merged.isAnswered = true
		}
		return merged
	})
}

export function mergeApiMessageSnapshots(existing: unknown, incoming: unknown): unknown {
	return mergeTimestampedSnapshots(existing, incoming, (disk, next) => {
		const toolUseId = disk.delegationResultToolUseId
		if (typeof toolUseId !== "string" || !Array.isArray(disk.content) || next.role !== "user") return next
		const matchesResult = (block: unknown) =>
			isRecord(block) && block.type === "tool_result" && block.tool_use_id === toolUseId
		const published = disk.content.find(matchesResult)
		if (!published) return next
		const content = Array.isArray(next.content)
			? next.content
			: typeof next.content === "string"
				? [{ type: "text", text: next.content }]
				: []
		return {
			...next,
			delegationResultToolUseId: toolUseId,
			content: content.some(matchesResult)
				? content.map((block) => (matchesResult(block) ? published : block))
				: [published, ...content],
		}
	})
}
