// Compatibility facade for the VS Code LM provider, context budget, and leaked tool recovery.
import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import OpenAI from "openai"

import {
	type ModelInfo,
	openAiModelInfoSaneDefaults,
	providerIdentifiers,
	vscodeLlmDefaultModelId,
	vscodeLlmModels,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { SELECTOR_SEPARATOR, stringifyVsCodeLmModelSelector } from "../../shared/vsCodeSelectorUtils"
import { normalizeToolSchema } from "../../utils/json-schema"

import { ApiStream } from "../transform/stream"
import {
	convertToVsCodeLmMessages,
	decodeToolNameSurrogates,
	extractTextCountFromMessage,
	sanitizeSurrogates,
	sanitizeSurrogatesDeep,
	sanitizeToolNameSurrogates,
} from "../transform/vscode-lm-format"

import { BaseProvider } from "./base-provider"
import { CONTEXT_WINDOW_EXCEEDED_STATUS } from "../../core/context/context-management/context-error-handling"
import { enforceConversationBudget } from "./vscode-lm-context-budget"
import { LeakedToolSalvage } from "./vscode-lm-tool-salvage"
import { getVsCodeLmModelInfo } from "./vscode-lm-capabilities"
import { createAbortError, hasUsableTimeout, toSdkTimeoutMs } from "./utils/abort-signal"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata, CompletePromptOptions } from "../index"

export { estimateMessagesChars, middleOutTruncate, truncateToolResultsToFitWindow } from "./vscode-lm-context-budget"
export {
	extractLeakedToolCalls,
	trailingPartialToolMarkerLength,
	type LeakedToolSchemas,
} from "./vscode-lm-leaked-tools"

/**
 * Converts OpenAI-format tools to VSCode Language Model tools.
 * Normalizes the JSON Schema to draft 2020-12 compliant format required by
 * GitHub Copilot's backend, converting type: ["T", "null"] to anyOf format.
 * @param tools Array of OpenAI ChatCompletionTool definitions
 * @returns Array of VSCode LanguageModelChatTool definitions
 */
function convertToVsCodeLmTools(tools: OpenAI.Chat.ChatCompletionTool[]): vscode.LanguageModelChatTool[] {
	return tools
		.filter((tool) => tool.type === "function")
		.map((tool) => ({
			// Declared names must stay within Copilot's ^[\w-]+$ validation while remaining distinct.
			name: sanitizeToolNameSurrogates(tool.function.name),
			description: sanitizeSurrogates(tool.function.description || ""),
			inputSchema: tool.function.parameters
				? (sanitizeSurrogatesDeep(
						normalizeToolSchema(tool.function.parameters as Record<string, unknown>),
					) as object)
				: undefined,
		}))
}

/** Structural check, so it holds for any host that supplies chat messages rather than one specific class. */
function isChatMessage(value: unknown): value is vscode.LanguageModelChatMessage {
	return typeof value === "object" && value !== null && "role" in value && "content" in value
}

/** True when any block, including those nested in tool results, carries an image. */
export function containsImageBlock(content: unknown): boolean {
	return (
		Array.isArray(content) &&
		content.some(
			(block: { type?: string; content?: unknown }) =>
				block.type === "image" || (block.type === "tool_result" && containsImageBlock(block.content)),
		)
	)
}

/**
 * Handles interaction with VS Code's Language Model API for chat-based operations.
 * This handler extends BaseProvider to provide VS Code LM specific functionality.
 *
 * @extends {BaseProvider}
 *
 * @remarks
 * The handler manages a VS Code language model chat client and provides methods to:
 * - Create and manage chat client instances
 * - Stream messages using VS Code's Language Model API
 * - Retrieve model information
 *
 * @example
 * ```typescript
 * const options = {
 *   vsCodeLmModelSelector: { vendor: "copilot", family: "gpt-4" }
 * };
 * const handler = new VsCodeLmHandler(options);
 *
 * // Stream a conversation
 * const systemPrompt = "You are a helpful assistant";
 * const messages = [{ role: "user", content: "Hello!" }];
 * for await (const chunk of handler.createMessage(systemPrompt, messages)) {
 *   console.log(chunk);
 * }
 * ```
 */
export class VsCodeLmHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected client: vscode.LanguageModelChat | null
	private disposable: vscode.Disposable | null
	// Provider label for the shared abort contract (createAbortError).
	private readonly providerName = "VS Code LM"
	private currentRequestCancellation: vscode.CancellationTokenSource | null
	// completePrompt requests do not use currentRequestCancellation (which belongs to
	// createMessage); they are tracked here so handler disposal cancels them too.
	private activeCompletionTokens = new Set<vscode.CancellationTokenSource>()

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.client = null
		this.disposable = null
		this.currentRequestCancellation = null

		try {
			// Listen for model changes and reset client
			this.disposable = vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("lm")) {
					try {
						this.client = null
						this.ensureCleanState()
					} catch (error) {
						console.error("Error during configuration change cleanup:", error)
					}
				}
			})
			void this.initializeClient().catch((error) => {
				console.debug(
					"Zoo Code <Language Model API>: Initial client setup failed; retrying on first use:",
					error,
				)
			})
		} catch (error) {
			// Ensure cleanup if constructor fails
			this.dispose()

			throw new Error(
				`Zoo Code <Language Model API>: Failed to initialize handler: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}
	/**
	 * Initializes the VS Code Language Model client.
	 * This method is called during the constructor to set up the client.
	 * This useful when the client is not created yet and call getModel() before the client is created.
	 * @returns Promise<void>
	 * @throws Error when client initialization fails
	 */
	async initializeClient(): Promise<void> {
		try {
			// Check if the client is already initialized
			if (this.client) {
				console.debug("Zoo Code <Language Model API>: Client already initialized")
				return
			}
			// Create a new client instance
			this.client = await this.createClient(this.options.vsCodeLmModelSelector || {})
			console.debug("Zoo Code <Language Model API>: Client initialized successfully")
		} catch (error) {
			// Handle errors during client initialization
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error("Zoo Code <Language Model API>: Client initialization failed:", errorMessage)
			throw new Error(`Zoo Code <Language Model API>: Failed to initialize client: ${errorMessage}`)
		}
	}
	/**
	 * Creates a language model chat client based on the provided selector.
	 *
	 * @param selector - Selector criteria to filter language model chat instances
	 * @returns Promise resolving to the first matching language model chat instance
	 * @throws Error when no matching models are found with the given selector
	 *
	 * @example
	 * const selector = { vendor: "copilot", family: "gpt-4o" };
	 * const chatClient = await createClient(selector);
	 */
	async createClient(selector: vscode.LanguageModelChatSelector): Promise<vscode.LanguageModelChat> {
		try {
			const models = await vscode.lm.selectChatModels(selector)

			// Use first available model or create a minimal model object
			if (models && Array.isArray(models) && models.length > 0) {
				return models[0]
			}

			return this.createFallbackClient()
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			throw new Error(`Zoo Code <Language Model API>: Failed to select model: ${errorMessage}`)
		}
	}

	/**
	 * Client used when no installed model matches the selector. Subclasses whose models are not
	 * interchangeable with a stub may refuse instead.
	 */
	protected createFallbackClient(): vscode.LanguageModelChat {
		return {
			id: "default-lm",
			name: "Default Language Model",
			vendor: "vscode",
			family: "lm",
			version: "1.0",
			maxInputTokens: 8192,
			sendRequest: async () => ({
				stream: (async function* () {
					yield new vscode.LanguageModelTextPart(
						"Language model functionality is limited. Please check VS Code configuration.",
					)
				})(),
				text: (async function* () {
					yield "Language model functionality is limited. Please check VS Code configuration."
				})(),
			}),
			countTokens: async () => 0,
		}
	}

	/** Model info for a live client. */
	protected deriveModelInfo(client: vscode.LanguageModelChat, modelId: string): ModelInfo {
		return {
			maxTokens: -1, // Unlimited tokens by default
			contextWindow:
				typeof client.maxInputTokens === "number"
					? Math.max(0, client.maxInputTokens)
					: openAiModelInfoSaneDefaults.contextWindow,
			supportsImages: getVsCodeLmModelInfo(client).supportsImages,
			supportsPromptCache: true,
			inputPrice: 0,
			outputPrice: 0,
			description: `VSCode Language Model: ${modelId}`,
		}
	}

	/** Model info reported before any client exists. */
	protected getFallbackModelInfo(): ModelInfo {
		return { ...openAiModelInfoSaneDefaults, supportsImages: undefined }
	}

	/** Whether image parts are sent to the model. */
	protected supportsImageInput(info: ModelInfo): boolean {
		return info.supportsImages === true
	}

	/** Rejects a request the selected model cannot serve before anything is sent. */
	protected assertRequestSupported(_messages: Anthropic.Messages.MessageParam[], _info: ModelInfo): void {}

	/** Rejects a request whose measured input exceeds what the model accepts. */
	protected assertWithinContextWindow(inputTokens: number, info: ModelInfo): void {
		// Native images are absent from the character budget; use the host's measured input too.
		if (
			this.supportsImageInput(info) &&
			inputTokens > Math.min(this.getCondenseContextWindow(), info.contextWindow)
		) {
			throw Object.assign(
				new Error(
					"The request exceeds the selected VS Code model's input context window. Condense the conversation or start a new task.",
				),
				{ status: CONTEXT_WINDOW_EXCEEDED_STATUS },
			)
		}
	}

	/** The form in which a chat message is handed to the host's token counter. */
	protected prepareMessageForCounting(
		message: vscode.LanguageModelChatMessage,
	): string | vscode.LanguageModelChatMessage {
		return this.supportsImageInput(this.getModel().info) ? message : extractTextCountFromMessage(message)
	}

	/**
	 * Creates and streams a message using the VS Code Language Model API.
	 *
	 * @param systemPrompt - The system prompt to initialize the conversation context
	 * @param messages - An array of message parameters following the Anthropic message format
	 * @param metadata - Optional metadata for the message
	 *
	 * @yields {ApiStream} An async generator that yields either text chunks or tool calls from the model response
	 *
	 * @throws {Error} When vsCodeLmModelSelector option is not provided
	 * @throws {Error} When the response stream encounters an error
	 *
	 * @remarks
	 * This method handles the initialization of the VS Code LM client if not already created,
	 * converts the messages to VS Code LM format, and streams the response chunks.
	 * Tool calls handling is currently a work in progress.
	 */
	dispose(): void {
		if (this.disposable) {
			this.disposable.dispose()
		}

		if (this.currentRequestCancellation) {
			this.currentRequestCancellation.cancel()
			this.currentRequestCancellation.dispose()
		}

		// Cancel every in-flight completion request: a host request still running after the
		// handler is disposed would otherwise keep streaming with no owner to stop it.
		for (const tokenSource of this.activeCompletionTokens) {
			tokenSource.cancel()
			tokenSource.dispose()
		}
		this.activeCompletionTokens.clear()
	}

	/**
	 * Implements the ApiHandler countTokens interface method
	 * Provides token counting for Anthropic content blocks
	 *
	 * @param content The content blocks to count tokens for
	 * @returns A promise resolving to the token count
	 */
	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		if (this.supportsImageInput(this.getModel().info) && containsImageBlock(content)) {
			return this.calculateTotalInputTokens(convertToVsCodeLmMessages([{ role: "user", content }], true))
		}

		// Preserve text-only counting for models that cannot send native images.
		let textContent = ""

		for (const block of content) {
			if (block.type === "text") {
				textContent += block.text || ""
			} else if (block.type === "image") {
				textContent += "[IMAGE]"
			}
		}

		return this.internalCountTokens(textContent)
	}

	/**
	 * Private implementation of token counting used internally by VsCodeLmHandler
	 */
	private async internalCountTokens(text: string | vscode.LanguageModelChatMessage): Promise<number> {
		// Check for required dependencies
		if (!this.client) {
			console.warn("Zoo Code <Language Model API>: No client available for token counting")
			return 0
		}

		// Validate input
		if (!text) {
			console.debug("Zoo Code <Language Model API>: Empty text provided for token counting")
			return 0
		}

		// Create a temporary cancellation token if we don't have one (e.g., when called outside a request)
		let cancellationToken: vscode.CancellationToken
		let tempCancellation: vscode.CancellationTokenSource | null = null

		if (this.currentRequestCancellation) {
			cancellationToken = this.currentRequestCancellation.token
		} else {
			tempCancellation = new vscode.CancellationTokenSource()
			cancellationToken = tempCancellation.token
		}

		try {
			// Handle different input types
			let tokenCount: number

			if (typeof text === "string") {
				tokenCount = await this.client.countTokens(text, cancellationToken)
			} else if (isChatMessage(text)) {
				// For chat messages, ensure we have content
				if (!text.content || (Array.isArray(text.content) && text.content.length === 0)) {
					console.debug("Zoo Code <Language Model API>: Empty chat message content")
					return 0
				}
				const countMessage = this.prepareMessageForCounting(text)
				tokenCount = await this.client.countTokens(countMessage, cancellationToken)
			} else {
				console.warn("Zoo Code <Language Model API>: Invalid input type for token counting")
				return 0
			}

			// Validate the result
			if (typeof tokenCount !== "number") {
				console.warn("Zoo Code <Language Model API>: Non-numeric token count received:", tokenCount)
				return 0
			}

			if (tokenCount < 0) {
				console.warn("Zoo Code <Language Model API>: Negative token count received:", tokenCount)
				return 0
			}

			return tokenCount
		} catch (error) {
			// Handle specific error types
			if (error instanceof vscode.CancellationError) {
				console.debug("Zoo Code <Language Model API>: Token counting cancelled by user")
				return 0
			}

			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.warn("Zoo Code <Language Model API>: Token counting failed:", errorMessage)

			// Log additional error details if available
			if (error instanceof Error && error.stack) {
				console.debug("Token counting error stack:", error.stack)
			}

			return 0 // Fallback to prevent stream interruption
		} finally {
			// Clean up temporary cancellation token
			if (tempCancellation) {
				tempCancellation.dispose()
			}
		}
	}

	protected async calculateTotalInputTokens(vsCodeLmMessages: vscode.LanguageModelChatMessage[]): Promise<number> {
		const messageTokens: number[] = await Promise.all(vsCodeLmMessages.map((msg) => this.internalCountTokens(msg)))

		return messageTokens.reduce((sum: number, tokens: number): number => sum + tokens, 0)
	}

	protected ensureCleanState(): void {
		if (this.currentRequestCancellation) {
			this.currentRequestCancellation.cancel()
			this.currentRequestCancellation.dispose()
			this.currentRequestCancellation = null
		}
	}

	/**
	 * Releases one request's cancellation source. Unlike ensureCleanState(), it leaves a newer
	 * request alone: a request that fails after another has started must not cancel that one.
	 */
	protected releaseRequestCancellation(source: vscode.CancellationTokenSource): void {
		source.cancel()
		source.dispose()
		if (this.currentRequestCancellation === source) {
			this.currentRequestCancellation = null
		}
	}

	protected async getClient(): Promise<vscode.LanguageModelChat> {
		if (!this.client) {
			console.debug("Zoo Code <Language Model API>: Getting client with options:", {
				vsCodeLmModelSelector: this.options.vsCodeLmModelSelector,
				hasOptions: !!this.options,
				selectorKeys: this.options.vsCodeLmModelSelector ? Object.keys(this.options.vsCodeLmModelSelector) : [],
			})

			try {
				// Use default empty selector if none provided to get all available models
				const selector = this.options?.vsCodeLmModelSelector || {}
				console.debug("Zoo Code <Language Model API>: Creating client with selector:", selector)
				this.client = await this.createClient(selector)
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error"
				console.error("Zoo Code <Language Model API>: Client creation failed:", message)
				throw new Error(`Zoo Code <Language Model API>: Failed to create client: ${message}`)
			}
		}

		return this.client
	}

	private cleanMessageContent(
		content: Anthropic.Messages.MessageParam["content"],
	): Anthropic.Messages.MessageParam["content"] {
		return this.deepClean(content) as Anthropic.Messages.MessageParam["content"]
	}

	private deepClean(value: unknown): unknown {
		if (!value) {
			return value
		}

		if (typeof value === "string") {
			return value
		}

		if (Array.isArray(value)) {
			return value.map((item) => this.deepClean(item))
		}

		if (typeof value === "object") {
			const cleaned: Record<string, unknown> = {}
			for (const [key, v] of Object.entries(value)) {
				cleaned[key] = this.deepClean(v)
			}
			return cleaned
		}

		return value
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Ensure clean state before starting a new request
		this.ensureCleanState()

		// The VS Code LanguageModelChat API cannot carry an AbortSignal, so the
		// request cancellation is established before client initialization and a
		// pre-aborted external signal is reported immediately instead of being
		// sent to the host.
		const externalAbortSignal = metadata?.abortSignal

		// Initialize cancellation token for the request before getClient() so the
		// client-initialization await is covered by the abort bridge and the
		// finally cleanup below.
		this.currentRequestCancellation = new vscode.CancellationTokenSource()
		const cancellationTokenSource = this.currentRequestCancellation

		// Bridge the caller's abort signal (e.g. a task abort) into the request's
		// cancellation token: the VS Code LM API cannot carry an AbortSignal
		// directly, so cancellation is signalled to the host through the token.
		// The listener is kept in a named const and removed in the finally block
		// because { once: true } only detaches it when the signal actually aborts.
		let onExternalAbort: (() => void) | undefined
		// Recorded separately from the token: cleanup also cancels the token, and a
		// host token's flag is not observable before its cancel settles, so the
		// token alone cannot always tell a caller's abort apart at a re-check point.
		let abortedByCaller = false
		if (externalAbortSignal) {
			onExternalAbort = () => {
				abortedByCaller = true
				cancellationTokenSource.cancel()
			}
			externalAbortSignal.addEventListener("abort", onExternalAbort, { once: true })
		}

		// Accumulate the text and count at the end of the stream to reduce token counting overhead.
		let accumulatedText: string = ""

		// Only offered tools may be recovered; their schemas keep recovered parameters typed
		// rather than passing every value through as a string.
		const providedTools = (metadata?.tools ?? [])
			.filter((tool) => tool.type === "function")
			.filter((tool) => tool.function.name.length > 0)
		const providedToolSchemas = new Map(
			providedTools.map((tool) => [
				tool.function.name,
				tool.function.parameters as Record<string, unknown> | undefined,
			]),
		)
		const encodedToolAliases = new Map<string, string | undefined>()
		for (const tool of providedTools) {
			const encodedName = sanitizeToolNameSurrogates(tool.function.name)
			// Raw names retain their schema and meaning even when another tool encodes to that name.
			if (!providedToolSchemas.has(encodedName)) {
				encodedToolAliases.set(
					encodedName,
					encodedToolAliases.has(encodedName) ? undefined : tool.function.name,
				)
			}
		}
		for (const [encodedName, originalName] of encodedToolAliases) {
			if (originalName !== undefined) {
				providedToolSchemas.set(encodedName, providedToolSchemas.get(originalName))
			}
		}
		const toolSalvage = new LeakedToolSalvage(providedToolSchemas, encodedToolAliases)

		try {
			// Fail fast if the caller already aborted before we even started: do not
			// initialize or invoke the host request for a cancelled request.
			if (externalAbortSignal?.aborted) {
				cancellationTokenSource.cancel()
				throw createAbortError(this.providerName)
			}

			const client: vscode.LanguageModelChat = await this.getClient()

			// Re-check immediately after client initialization: the request-local token
			// may have been cancelled while getClient() was pending — either because the
			// external signal aborted (bridged into the token) or because a newer request
			// superseded this one and cancelled its token. Bail before counting input
			// tokens or invoking the host so no work happens for a cancelled request.
			// The token is the superset here: the bridge makes every external abort cancel it.
			if (abortedByCaller || cancellationTokenSource.token.isCancellationRequested) {
				cancellationTokenSource.cancel()
				throw createAbortError(this.providerName)
			}

			const modelInfo = this.getModel().info

			// Process messages
			const cleanedMessages = messages.map((msg) => ({
				...msg,
				content: this.cleanMessageContent(msg.content),
			}))
			this.assertRequestSupported(cleanedMessages, modelInfo)

			enforceConversationBudget(cleanedMessages, this.getCondenseContextWindow(), systemPrompt, metadata?.tools)

			// Convert Anthropic messages to VS Code LM messages
			const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = [
				vscode.LanguageModelChatMessage.Assistant(sanitizeSurrogates(systemPrompt)),
				...convertToVsCodeLmMessages(cleanedMessages, this.supportsImageInput(modelInfo)),
			]

			// Calculate input tokens before starting the stream
			const totalInputTokens: number = await this.calculateTotalInputTokens(vsCodeLmMessages)

			// Re-check the request-local token after counting: the external signal may
			// have aborted while counting was in flight (bridged into the token) or a
			// newer request may have superseded this one and cancelled its token. Bail
			// before invoking the host so no work happens for a cancelled request. The
			// token is the superset here: the bridge makes every external abort cancel it.
			if (abortedByCaller || cancellationTokenSource.token.isCancellationRequested) {
				throw createAbortError(this.providerName)
			}
			this.assertWithinContextWindow(totalInputTokens, modelInfo)

			// Create the response stream with required options
			const requestOptions: vscode.LanguageModelChatRequestOptions = {
				justification: `Zoo Code would like to use '${client.name}' from '${client.vendor}', Click 'Allow' to proceed.`,
				tools: convertToVsCodeLmTools(metadata?.tools ?? []),
			}
			const response: vscode.LanguageModelChatResponse = await client.sendRequest(
				vsCodeLmMessages,
				requestOptions,
				cancellationTokenSource.token,
			)

			// Consume the stream and handle both text and tool call chunks
			for await (const chunk of response.stream) {
				// A late abort while consuming must stop the stream instead of
				// yielding stale chunks. The request-local token also covers local
				// supersession (a newer request cancels this one), which the external
				// signal alone cannot see.
				if (externalAbortSignal?.aborted || cancellationTokenSource.token.isCancellationRequested) {
					throw createAbortError(this.providerName)
				}
				if (chunk instanceof vscode.LanguageModelTextPart) {
					// Validate text part value
					if (typeof chunk.value !== "string") {
						console.warn("Zoo Code <Language Model API>: Invalid text part value received:", chunk.value)
						continue
					}

					accumulatedText += chunk.value

					// Fast path: when we didn't offer any tools there is nothing to salvage, so
					// stream the text straight through exactly as before.
					if (providedToolSchemas.size === 0) {
						yield { type: "text", text: chunk.value }
						continue
					}
					yield* toolSalvage.push(chunk.value)
				} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
					yield* toolSalvage.flush()
					try {
						// Validate tool call parameters
						if (!chunk.name || typeof chunk.name !== "string") {
							console.warn("Zoo Code <Language Model API>: Invalid tool name received:", chunk.name)
							continue
						}

						if (!chunk.callId || typeof chunk.callId !== "string") {
							console.warn("Zoo Code <Language Model API>: Invalid tool callId received:", chunk.callId)
							continue
						}

						// Ensure input is a valid object
						if (!chunk.input || typeof chunk.input !== "object") {
							console.warn("Zoo Code <Language Model API>: Invalid tool input received:", chunk.input)
							continue
						}

						// Log tool call for debugging
						console.debug("Zoo Code <Language Model API>: Processing tool call:", {
							name: chunk.name,
							callId: chunk.callId,
							inputSize: JSON.stringify(chunk.input).length,
						})

						// Yield native tool_call chunk when tools are provided
						if (metadata?.tools?.length) {
							const argumentsString = JSON.stringify(chunk.input)
							accumulatedText += argumentsString
							yield {
								type: "tool_call",
								id: chunk.callId,
								// Undo the declaration-time encoding; dispatch matches registry names.
								name: decodeToolNameSurrogates(chunk.name),
								arguments: argumentsString,
							}
						}
					} catch (error) {
						console.error("Zoo Code <Language Model API>: Failed to process tool call:", error)
						// Continue processing other chunks even if one fails
						continue
					}
				} else {
					console.warn("Zoo Code <Language Model API>: Unknown chunk type received:", chunk)
				}
			}

			// Guard against a quiet stream end after the request was aborted or superseded:
			// the in-loop check only fires when the host delivers another chunk, so a stream
			// that ends normally after cancellation would otherwise complete with partial
			// text and a usage chunk instead of rejecting with the canonical abort.
			// The guard runs before the salvage flush: an aborted request must not emit
			// any further content, and the per-request salvage state is moot once the
			// request is rejected.
			if (externalAbortSignal?.aborted || cancellationTokenSource.token.isCancellationRequested) {
				throw createAbortError(this.providerName)
			}

			// Flush any leaked tool-call recovery state accumulated during streaming.
			yield* toolSalvage.flush()

			// Count tokens in the accumulated text after stream completion
			const totalOutputTokens: number = await this.internalCountTokens(accumulatedText)

			// internalCountTokens returns 0 on cancellation: re-check before reporting usage so an
			// abort landing during the count rejects with the contract AbortError instead of
			// completing normally with a zero-output usage chunk. The guard above the count runs
			// before the await and does not cover this window.
			if (externalAbortSignal?.aborted || cancellationTokenSource.token.isCancellationRequested) {
				throw createAbortError(this.providerName)
			}

			// Report final usage after stream completion
			yield {
				type: "usage",
				inputTokens: totalInputTokens,
				outputTokens: totalOutputTokens,
			}
		} catch (error: unknown) {
			// When this request is already cancelled while getClient() was pending or
			// rejected — the external signal aborted (bridged into the token) or a
			// newer request superseded this one and cancelled its token — surface a
			// standard abort error instead of leaking the raw client-initialization
			// failure. completePrompt normalizes the same case through isAborted(),
			// which includes the token state; both methods follow that contract.
			if (externalAbortSignal?.aborted || cancellationTokenSource.token.isCancellationRequested) {
				throw createAbortError(this.providerName)
			}

			if (error instanceof vscode.CancellationError) {
				// The host rejected because the request was cancelled: either the
				// bridged external signal aborted or the user cancelled the request
				// in VS Code. Both are aborts, so surface the shared canonical error
				// instead of a hand-built copy.
				throw createAbortError(this.providerName)
			}

			if (error instanceof Error) {
				console.error("Zoo Code <Language Model API>: Stream error details:", {
					message: error.message,
					stack: error.stack,
					name: error.name,
				})

				// Return original error if it's already an Error instance
				throw error
			} else if (typeof error === "object" && error !== null) {
				// Handle error-like objects
				const errorDetails = JSON.stringify(error, null, 2)
				console.error("Zoo Code <Language Model API>: Stream error object:", errorDetails)
				throw new Error(`Zoo Code <Language Model API>: Response stream error: ${errorDetails}`)
			} else {
				// Fallback for unknown error types
				const errorMessage = String(error)
				console.error("Zoo Code <Language Model API>: Unknown stream error:", errorMessage)
				throw new Error(`Zoo Code <Language Model API>: Response stream error: ${errorMessage}`)
			}
		} finally {
			// Detach the abort bridge listener on every path (success, error, and
			// early consumer break); { once: true } alone would leak it when the
			// request completes without the signal ever aborting.
			if (externalAbortSignal && onExternalAbort) {
				externalAbortSignal.removeEventListener("abort", onExternalAbort)
			}
			// Cancel before disposing: VS Code's CancellationTokenSource.dispose()
			// frees resources without cancelling the token, so a premature consumer
			// closure (break/return) would otherwise leave the host request running and
			// consuming model quota. Cancel is idempotent, so this is a no-op on paths
			// where the token was already cancelled (aborted or timed-out request).
			cancellationTokenSource.cancel()
			// Dispose the request-local source. Clear the shared field only if it still
			// points at this request's source: a newer request may have replaced it, and
			// disposing the shared field here would cancel and dispose the newer request's
			// token.
			cancellationTokenSource.dispose()
			if (this.currentRequestCancellation === cancellationTokenSource) {
				this.currentRequestCancellation = null
			}
		}
	}

	// Return model information based on the current client state
	override getModel(): { id: string; info: ModelInfo } {
		if (this.client) {
			// Validate client properties
			const requiredProps = {
				id: this.client.id,
				vendor: this.client.vendor,
				family: this.client.family,
				version: this.client.version,
				maxInputTokens: this.client.maxInputTokens,
			}

			// Log any missing properties for debugging
			for (const [prop, value] of Object.entries(requiredProps)) {
				if (!value && value !== 0) {
					console.warn(`Zoo Code <Language Model API>: Client missing ${prop} property`)
				}
			}

			// Construct model ID using available information
			const modelParts = [this.client.vendor, this.client.family, this.client.version].filter(Boolean)

			const modelId = this.client.id || modelParts.join(SELECTOR_SEPARATOR)
			return { id: modelId, info: this.deriveModelInfo(this.client, modelId) }
		}

		// Fallback when no client is available
		const fallbackId = this.options.vsCodeLmModelSelector
			? stringifyVsCodeLmModelSelector(this.options.vsCodeLmModelSelector)
			: providerIdentifiers.vscodeLm

		console.debug("Zoo Code <Language Model API>: No client available, using fallback model info")

		return {
			id: fallbackId,
			info: {
				...this.getFallbackModelInfo(),
				description: `VSCode Language Model (Fallback): ${fallbackId}`,
			},
		}
	}

	/**
	 * Context window for auto-condense. The API's advertised `client.maxInputTokens` is far larger
	 * than usable, so relying on it stops auto-condense from firing; measure against the curated
	 * static table's `maxInputTokens` instead (the same value the bar uses). An unknown family (e.g.
	 * a selector left over from a model dropped from the catalog) resolves to the default row rather
	 * than the inflated live window; only a non-positive static `maxInputTokens` falls back to it.
	 */
	getCondenseContextWindow(): number {
		const family = this.client?.family ?? this.options.vsCodeLmModelSelector?.family
		const staticModel = family
			? (vscodeLlmModels[family as keyof typeof vscodeLlmModels] ?? vscodeLlmModels[vscodeLlmDefaultModelId])
			: vscodeLlmModels[vscodeLlmDefaultModelId]

		if (staticModel && typeof staticModel.maxInputTokens === "number" && staticModel.maxInputTokens > 0) {
			return staticModel.maxInputTokens
		}

		return this.getModel().info.contextWindow
	}

	/** Request options for single-shot completions; the generic provider sends none. */
	protected getCompletionRequestOptions(_client: vscode.LanguageModelChat): vscode.LanguageModelChatRequestOptions {
		return {}
	}

	async completePrompt(prompt: string, options?: CompletePromptOptions): Promise<string> {
		// The VS Code LanguageModelChat API cannot carry an AbortSignal: sendRequest
		// only accepts a CancellationToken. Bridge the external signal and timeout
		// into a request-local CancellationTokenSource instead. Cancellation is
		// established before client initialization so the getClient() await is covered
		// by the timeout, the abort bridge, and the finally cleanup below.
		const tokenSource = new vscode.CancellationTokenSource()
		this.activeCompletionTokens.add(tokenSource)
		const externalAbortSignal = options?.abortSignal

		// Apply the timeout only when the effective value (option, else the provider-wide
		// request timeout default) is positive: cancelling at once for a
		// zero/negative timeout would abort every such request immediately. Starting
		// the timer before getClient() means a timeout that fires during a slow client
		// lookup still cancels the request before any sendRequest call.
		let timeoutId: ReturnType<typeof setTimeout> | undefined
		const timeoutMs = options?.timeoutMs ?? this.timeoutMs
		if (hasUsableTimeout(timeoutMs)) {
			// hasUsableTimeout/toSdkTimeoutMs own the "disabled" and non-finite semantics:
			// Node clamps large delays to 1 ms and rejects fractional ones, so only a
			// rounded, capped budget reaches setTimeout.
			timeoutId = setTimeout(() => tokenSource.cancel(), toSdkTimeoutMs(timeoutMs))
		}

		// Bridge the external abort signal: a pre-aborted signal cancels the token
		// immediately, otherwise a one-shot listener relays the abort to the host.
		let onAbort: (() => void) | undefined
		if (externalAbortSignal) {
			if (externalAbortSignal.aborted) {
				tokenSource.cancel()
			} else {
				onAbort = () => tokenSource.cancel()
				externalAbortSignal.addEventListener("abort", onAbort, { once: true })
			}
		}

		// The request counts as aborted when the host-side token was cancelled
		// (timeout or bridged signal) or when the external signal itself aborted.
		const isAborted = () =>
			tokenSource.token.isCancellationRequested === true || externalAbortSignal?.aborted === true

		try {
			// Fail fast if the caller already aborted before we even started: do not
			// initialize or invoke the host request for a cancelled request.
			if (isAborted()) {
				throw createAbortError(this.providerName)
			}
			const client = await this.getClient()

			// Re-check after client initialization: the signal may have aborted (or the
			// timeout fired) while getClient() was pending. Bail before invoking the host
			// so a timeout that fired during a slow client lookup can never lead to a
			// sendRequest call.
			if (isAborted()) {
				throw createAbortError(this.providerName)
			}

			const response = await client.sendRequest(
				[vscode.LanguageModelChatMessage.User(prompt)],
				this.getCompletionRequestOptions(client),
				tokenSource.token,
			)
			let result = ""
			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					result += chunk.value
				}
			}

			// Guard against a quiet completion after the request was aborted.
			if (isAborted()) {
				throw createAbortError(this.providerName)
			}

			return result
		} catch (error) {
			// Report an aborted request (external signal, timeout, or host
			// cancellation) as a standard AbortError instead of a generic
			// completion error. A host CancellationError is treated as a cancellation
			// even if the token flag was not observed (e.g. the host cancelled the
			// request through the token without the flag being set).
			if (isAborted() || error instanceof vscode.CancellationError) {
				throw createAbortError(this.providerName)
			}

			if (error instanceof Error) {
				throw new Error(`VSCode LM completion error: ${error.message}`)
			}
			throw error
		} finally {
			// clearTimeout(undefined) is a spec no-op, so clear unconditionally.
			clearTimeout(timeoutId)
			// { once: true } only detaches the listener when the signal actually
			// aborts, so remove it explicitly on every path.
			if (externalAbortSignal && onAbort) {
				externalAbortSignal.removeEventListener("abort", onAbort)
			}
			this.activeCompletionTokens.delete(tokenSource)
			tokenSource.dispose()
		}
	}
}

// Static blacklist of VS Code Language Model IDs that should be excluded from the model list e.g. because they will never work
export const VSCODE_LM_STATIC_BLACKLIST: string[] = ["claude-3.7-sonnet", "claude-3.7-sonnet-thought"]

export async function getVsCodeLmModels() {
	try {
		const models = (await vscode.lm.selectChatModels({})) || []
		return models
			.filter((model) => !VSCODE_LM_STATIC_BLACKLIST.includes(model.id))
			.map((model) => ({
				id: model.id,
				vendor: model.vendor,
				family: model.family,
				version: model.version,
				name: model.name,
				maxInputTokens: model.maxInputTokens,
				modelInfo: getVsCodeLmModelInfo(model),
			}))
	} catch (error) {
		console.error(
			`Error fetching VS Code LM models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
		return []
	}
}
