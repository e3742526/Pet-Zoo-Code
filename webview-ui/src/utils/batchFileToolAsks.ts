import type { ClineMessage, ClineSayTool } from "@roo-code/types"

import { batchNearby } from "./batchNearby"
import { isBoundary, isIgnorableBetweenTargets } from "./chatBatchingPredicates"

const batchKinds = ["read", "list", "edit"] as const
type BatchKind = (typeof batchKinds)[number]

const editFileTools = new Set([
	"editedExistingFile",
	"appliedDiff",
	"newFileCreated",
	"insertContent",
	"searchAndReplace",
])

function parseTool(text: string | undefined): ClineSayTool | undefined {
	if (!text) return undefined
	try {
		return JSON.parse(text) ?? undefined
	} catch {
		return undefined
	}
}

function classifyTool(tool: ClineSayTool | undefined): BatchKind | undefined {
	switch (tool?.tool) {
		case "readFile":
			return tool.batchFiles ? undefined : "read"
		case "listFilesTopLevel":
		case "listFilesRecursive":
			return tool.batchDirs ? undefined : "list"
		default:
			return tool && editFileTools.has(tool.tool) && !tool.batchDiffs ? "edit" : undefined
	}
}

function makeBatchPayload(kind: BatchKind, tools: ClineSayTool[]): ClineSayTool {
	const first = tools[0]
	switch (kind) {
		case "read":
			return {
				...first,
				batchFiles: tools.map((tool) => ({
					path: tool.path || "",
					lineSnippet: tool.reason || "",
					isOutsideWorkspace: tool.isOutsideWorkspace || false,
					key: `${tool.path}${tool.reason ? ` (${tool.reason})` : ""}`,
					content: tool.content || "",
				})),
			}
		case "list":
			return {
				...first,
				batchDirs: tools.map((tool) => ({
					path: tool.path || "",
					recursive: tool.tool === "listFilesRecursive",
					isOutsideWorkspace: tool.isOutsideWorkspace || false,
					key: tool.path || "",
				})),
			}
		case "edit":
			return {
				...first,
				batchDiffs: tools.map((tool) => ({
					path: tool.path || "",
					changeCount: 1,
					key: tool.path || "",
					content: tool.content || tool.diff || "",
					diffStats: tool.diffStats,
				})),
			}
	}
}

type SerializedBatch = { kind: BatchKind; inputs: ClineMessage["text"][]; text: string }

/** Reuse tool classifications and batch text while a chat transcript streams. */
export function createFileToolBatcher() {
	const classifications = new WeakMap<ClineMessage, { text: string | undefined; kind: BatchKind | undefined }>()
	let previousBatches = new WeakMap<ClineMessage, SerializedBatch>()

	function getKind(message: ClineMessage): BatchKind | undefined {
		if (message.type !== "ask" || message.ask !== "tool") return undefined
		const text = message.text
		const cached = classifications.get(message)
		if (cached && cached.text === text) return cached.kind

		const kind = classifyTool(parseTool(text))
		classifications.set(message, { text, kind })
		return kind
	}

	return (messages: ClineMessage[]): ClineMessage[] => {
		const batches = new WeakMap<ClineMessage, SerializedBatch>()
		let result = messages
		for (const kind of batchKinds) {
			result = batchNearby(result, {
				isTarget: (message) => getKind(message) === kind,
				isIgnorableBetweenTargets,
				isBoundary,
				synthesize(batch) {
					const first = batch[0]
					const previous = previousBatches.get(first)
					let cached: SerializedBatch
					if (
						previous?.kind === kind &&
						previous.inputs.length === batch.length &&
						batch.every((message, index) => message.text === previous.inputs[index])
					) {
						cached = previous
					} else {
						const inputs = batch.map((message) => message.text)
						const tools = inputs.map(parseTool)
						if (!tools.every((tool) => tool !== undefined)) return first
						cached = { kind, inputs, text: JSON.stringify(makeBatchPayload(kind, tools)) }
					}
					batches.set(first, cached)
					const message = { ...first, text: cached.text }
					classifications.set(message, { text: message.text, kind: undefined })
					return message
				},
			})
		}
		previousBatches = batches
		return result
	}
}
