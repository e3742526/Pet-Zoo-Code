import type { Anthropic } from "@anthropic-ai/sdk"
import { randomUUID } from "crypto"
import { promises as fs } from "fs"
import * as os from "os"
import * as path from "path"

import type { ModelInfo } from "@roo-code/types"

import type { ApiHandlerCreateMessageMetadata, CompletePromptOptions, SingleCompletionHandler } from "../../index"
import type {
	ApiStream,
	ApiStreamReasoningChunk,
	ApiStreamTextChunk,
	ApiStreamToolCallChunk,
	ApiStreamUsageChunk,
} from "../../transform/stream"
import { BaseProvider } from "../base-provider"

import { buildAgentPrompt, buildCompletionPrompt } from "./prompt"
import { ToolCallStreamParser, type ToolCallProtocolEvent } from "./tool-call-protocol"

/** Normalized output of one CLI turn. */
export type CliTurnEvent = ApiStreamTextChunk | ApiStreamReasoningChunk | ApiStreamUsageChunk

export interface CliTurnRequest {
	prompt: string
	signal?: AbortSignal
	/** Folder used as the CLI working directory. It contains no project files. */
	workingDirectory: string
	/** Private folder for this turn only (for example for a prompt file). Removed after the turn. */
	scratchDirectory: string
}

/**
 * Working directory for CLI turns. It is deliberately outside the workspace: Zoo Code gives the
 * model all workspace context itself, and a neutral folder keeps any built-in read tool that the
 * CLI cannot switch off away from project files and workspace-specific CLI rules.
 */
async function getNeutralWorkingDirectory(providerId: string): Promise<string> {
	// The user ID keeps accounts apart where they share one temporary folder.
	const uid = process.getuid?.()
	const root = path.join(os.tmpdir(), uid === undefined ? "zoo-code-cli-providers" : `zoo-code-cli-providers-${uid}`)
	await ensurePrivateDirectory(root)
	const directory = path.join(root, providerId)
	await ensurePrivateDirectory(directory)
	return directory
}

/**
 * Creates a folder that only this user can use, or checks an existing one. On Linux the
 * temporary folder is shared, so another account could create this predictable path first
 * and leave CLI configuration in it. A link or a folder with another owner is rejected.
 */
export async function ensurePrivateDirectory(directory: string): Promise<void> {
	try {
		await fs.mkdir(directory, { mode: 0o700 })
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
	}
	const stat = await fs.lstat(directory)
	// Windows has no numeric user ID, and its temporary folder is already per user.
	const uid = process.getuid?.()
	if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) {
		throw new Error(`"${directory}" is not a private folder of the current user. Remove it and try again.`)
	}
	if (uid !== undefined) await fs.chmod(directory, 0o700)
}

/** Tool call IDs use only characters that every provider accepts, so a task can switch providers. */
export function createCliToolCallId(): string {
	return `call_${randomUUID().replace(/-/g, "")}`
}

/**
 * Base class for providers that run a subscription CLI (Muse Code, Antigravity) as a stateless
 * model backend.
 *
 * Zoo Code keeps ownership of the agent loop: the CLI's built-in tools are switched off, Zoo Code
 * tools are described in the prompt, and tool calls are parsed from the model text (see
 * tool-call-protocol.ts). Approvals, checkpoints, modes, and context management therefore work as
 * they do for API providers.
 */
export abstract class CliSubscriptionHandler extends BaseProvider implements SingleCompletionHandler {
	/** Provider identifier, used for the working directory name. */
	protected abstract readonly providerId: string

	/** Runs one CLI turn and yields its normalized output. Throws on failure. */
	protected abstract runTurn(request: CliTurnRequest): AsyncGenerator<CliTurnEvent>

	protected get deferToolCallsUntilTurnEnds(): boolean {
		return false
	}

	abstract override getModel(): { id: string; info: ModelInfo }

	private async *runTurnWithDirectories(prompt: string, signal?: AbortSignal): AsyncGenerator<CliTurnEvent> {
		const workingDirectory = await getNeutralWorkingDirectory(this.providerId)
		const scratchDirectory = await fs.mkdtemp(path.join(os.tmpdir(), `zoo-code-${this.providerId}-`))
		try {
			yield* this.runTurn({ prompt, signal, workingDirectory, scratchDirectory })
		} finally {
			await fs.rm(scratchDirectory, { recursive: true, force: true }).catch(() => {})
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const prompt = buildAgentPrompt(systemPrompt, messages, {
			tools: metadata?.tools,
			allowedFunctionNames: metadata?.allowedFunctionNames,
			parallelToolCalls: metadata?.parallelToolCalls,
		})
		const singleToolCall = metadata?.parallelToolCalls === false
		const parser = new ToolCallStreamParser()
		const deferToolCalls = this.deferToolCallsUntilTurnEnds
		const deferredOutput: Array<ApiStreamTextChunk | ApiStreamToolCallChunk> = []
		let toolCallCount = 0

		const convert = function* (
			events: ToolCallProtocolEvent[],
		): Generator<ApiStreamTextChunk | ApiStreamToolCallChunk> {
			for (const event of events) {
				// With parallel calls off, anything after the first call is dropped: the model was told
				// to stop there, and Zoo Code must not receive a second call.
				if (singleToolCall && toolCallCount > 0) continue
				let chunk: ApiStreamTextChunk | ApiStreamToolCallChunk
				if (event.type === "text") {
					chunk = { type: "text", text: event.text }
				} else {
					toolCallCount++
					chunk = {
						type: "tool_call",
						id: createCliToolCallId(),
						name: event.name,
						arguments: event.arguments,
					}
				}
				// Keep the order of text and tools while holding calls from a turn that can be retried.
				if (deferToolCalls && (chunk.type === "tool_call" || deferredOutput.length > 0)) {
					deferredOutput.push(chunk)
				} else {
					yield chunk
				}
			}
		}

		for await (const event of this.runTurnWithDirectories(prompt, metadata?.abortSignal)) {
			if (event.type === "text") {
				yield* convert(parser.push(event.text))
			} else {
				yield event
			}
		}
		yield* convert(parser.finish())
		yield* deferredOutput
	}

	async completePrompt(prompt: string, options?: CompletePromptOptions): Promise<string> {
		let text = ""
		for await (const event of this.runTurnWithDirectories(buildCompletionPrompt(prompt), options?.abortSignal)) {
			if (event.type === "text") text += event.text
		}
		return text.trim()
	}
}
