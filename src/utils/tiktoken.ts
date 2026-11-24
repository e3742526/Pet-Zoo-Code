import * as fs from "fs"
import * as path from "path"
import { Anthropic } from "@anthropic-ai/sdk"
import { init, Tiktoken } from "tiktoken/lite/init"
import type o200kBase from "tiktoken/encoders/o200k_base"

const TOKEN_FUDGE_FACTOR = 1.5
const TIKTOKEN_ASSET_MODULES = {
	"tiktoken_bg.wasm": "tiktoken/lite/tiktoken_bg.wasm",
	"tiktoken_o200k_base.json": "tiktoken/encoders/o200k_base.json",
} as const

let encoder: Tiktoken | undefined
let initPromise: Promise<Tiktoken> | undefined

function resolveTiktokenAssetPath(filename: keyof typeof TIKTOKEN_ASSET_MODULES): string {
	const candidates = [path.join(__dirname, filename), path.join(__dirname, "..", filename)]
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate
		}
	}
	return require.resolve(TIKTOKEN_ASSET_MODULES[filename])
}

async function loadTiktokenEncoder(): Promise<Tiktoken> {
	const wasmPath = resolveTiktokenAssetPath("tiktoken_bg.wasm")
	const encodingPath = resolveTiktokenAssetPath("tiktoken_o200k_base.json")
	const [wasmBytes, encodingJson] = await Promise.all([
		fs.promises.readFile(wasmPath),
		fs.promises.readFile(encodingPath, "utf8"),
	])
	const encoding: typeof o200kBase = JSON.parse(encodingJson)
	await init((imports) => WebAssembly.instantiate(wasmBytes, imports))
	encoder = new Tiktoken(encoding.bpe_ranks, encoding.special_tokens, encoding.pat_str)
	return encoder
}

function initializeTiktokenEncoder(): Promise<Tiktoken> {
	initPromise ??= loadTiktokenEncoder().catch((error) => {
		initPromise = undefined
		throw error
	})
	return initPromise
}

/**
 * Serializes a tool_use block to text for token counting.
 * Approximates how the API sees the tool call.
 */
function serializeToolUse(block: Anthropic.Messages.ToolUseBlockParam): string {
	const parts = [`Tool: ${block.name}`]
	if (block.input !== undefined) {
		try {
			parts.push(`Arguments: ${JSON.stringify(block.input)}`)
		} catch {
			parts.push(`Arguments: [serialization error]`)
		}
	}
	return parts.join("\n")
}

/**
 * Serializes a tool_result block to text for token counting.
 * Handles both string content and array content.
 */
function serializeToolResult(block: Anthropic.Messages.ToolResultBlockParam): string {
	const parts = [`Tool Result (${block.tool_use_id})`]

	if (block.is_error) {
		parts.push(`[Error]`)
	}

	const content = block.content
	if (typeof content === "string") {
		parts.push(content)
	} else if (Array.isArray(content)) {
		// Handle array of content blocks recursively
		for (const item of content) {
			if (item.type === "text") {
				parts.push(item.text || "")
			} else if (item.type === "image") {
				parts.push("[Image content]")
			} else {
				parts.push(`[Unsupported content block: ${String((item as { type?: unknown }).type)}]`)
			}
		}
	}

	return parts.join("\n")
}

export async function tiktoken(content: Anthropic.Messages.ContentBlockParam[]): Promise<number> {
	if (content.length === 0) {
		return 0
	}

	let totalTokens = 0

	const activeEncoder = encoder ?? (await initializeTiktokenEncoder())

	// Process each content block using the cached encoder.
	for (const block of content) {
		if (block.type === "text") {
			const text = block.text || ""

			if (text.length > 0) {
				const tokens = activeEncoder.encode(text, undefined, [])
				totalTokens += tokens.length
			}
		} else if (block.type === "image") {
			// For images, calculate based on data size.
			const imageSource = block.source

			if (imageSource && typeof imageSource === "object" && "data" in imageSource) {
				const base64Data = imageSource.data as string
				totalTokens += Math.ceil(Math.sqrt(base64Data.length))
			} else {
				totalTokens += 300 // Conservative estimate for unknown images
			}
		} else if (block.type === "tool_use") {
			// Serialize tool_use block to text and count tokens
			const serialized = serializeToolUse(block as Anthropic.Messages.ToolUseBlockParam)
			if (serialized.length > 0) {
				const tokens = activeEncoder.encode(serialized, undefined, [])
				totalTokens += tokens.length
			}
		} else if (block.type === "tool_result") {
			// Serialize tool_result block to text and count tokens
			const serialized = serializeToolResult(block as Anthropic.Messages.ToolResultBlockParam)
			if (serialized.length > 0) {
				const tokens = activeEncoder.encode(serialized, undefined, [])
				totalTokens += tokens.length
			}
		}
	}

	// Add a fudge factor to account for the fact that tiktoken is not always
	// accurate.
	return Math.ceil(totalTokens * TOKEN_FUDGE_FACTOR)
}
