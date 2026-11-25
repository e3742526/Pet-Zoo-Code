import { Anthropic } from "@anthropic-ai/sdk"
import crypto from "crypto"

import {
	type ProviderSettings,
	getApiProtocol,
	getModelId,
	isRetiredProvider,
	providerIdentifiers,
} from "@roo-code/types"

import type { ApiHandler } from "../../api"
import type { ApiStreamAssistantContentChunk } from "../../api/transform/stream"
import { sanitizeToolUseId } from "../../utils/tool-id"
import { getEffectiveApiHistory } from "../condense"
import type { ApiMessage } from "../task-persistence"
import { validateAndFixToolResultIds } from "./validateToolResultIds"

type ApiHistoryHandler = ApiHandler & {
	getResponseId?: () => string | undefined
	getEncryptedContent?: () => { encrypted_content: string; id?: string } | undefined
	getThoughtSignature?: () => string | undefined
	getThoughtSignatureOrigin?: () => string | undefined
	getReasoningDetails?: () => any[] | undefined
}

interface PrepareApiConversationMessageOptions {
	message: Anthropic.MessageParam
	reasoning?: string
	assistantContent?: ApiStreamAssistantContentChunk
	api: ApiHandler
	apiConfiguration: ProviderSettings
	apiConversationHistory: ApiMessage[]
}

export function prepareApiConversationMessage({
	message,
	reasoning,
	assistantContent,
	api,
	apiConfiguration,
	apiConversationHistory,
}: PrepareApiConversationMessageOptions): ApiMessage {
	if (message.role === "assistant") {
		return prepareAssistantMessage(message, reasoning, api as ApiHistoryHandler, apiConfiguration, assistantContent)
	}

	return prepareUserMessage(message, apiConversationHistory)
}

/** Put tool results before other user content, preserving order within each group. */
export function orderToolResultsFirst<Block extends Anthropic.Messages.ContentBlockParam>(content: Block[]): Block[] {
	let sawOtherContent = false
	for (const block of content) {
		if (block.type !== "tool_result") {
			sawOtherContent = true
		} else if (sawOtherContent) {
			// The API reads the leading tool results as the replies to the prior tool calls.
			return [
				...content.filter((part) => part.type === "tool_result"),
				...content.filter((part) => part.type !== "tool_result"),
			]
		}
	}
	return content
}

/** Limit provider-specific thinking blocks to the provider that produced them. */
export function getContentForProvider(
	message: ApiMessage,
	provider: ProviderSettings["apiProvider"],
): Anthropic.MessageParam["content"] {
	const { content, assistantContentProvider } = message
	if (
		message.role === "assistant" &&
		Array.isArray(content) &&
		assistantContentProvider !== provider &&
		(assistantContentProvider === providerIdentifiers.minimax || provider === providerIdentifiers.minimax)
	) {
		return content.filter((block) => block.type !== "thinking" && block.type !== "redacted_thinking")
	}
	return content
}

function restoreAssistantContent(
	savedContent: Anthropic.MessageParam["content"],
	providerContent: ApiStreamAssistantContentChunk["content"],
): Anthropic.Messages.ContentBlockParam[] | undefined {
	const savedToolCalls = Array.isArray(savedContent) ? savedContent.filter((block) => block.type === "tool_use") : []
	const content: Anthropic.Messages.ContentBlockParam[] = []
	let toolIndex = 0
	for (const block of providerContent) {
		if (block.type !== "tool_use") {
			content.push(block)
			continue
		}
		// Keep the tool calls accepted by the task. Do not restore a rejected or truncated call.
		const savedCall = savedToolCalls[toolIndex++]
		if (!savedCall || savedCall.id !== sanitizeToolUseId(block.id)) {
			return undefined
		}
		content.push(savedCall)
	}
	return toolIndex === savedToolCalls.length ? content : undefined
}

function prepareAssistantMessage(
	message: Anthropic.MessageParam,
	reasoning: string | undefined,
	handler: ApiHistoryHandler,
	apiConfiguration: ProviderSettings,
	assistantContent?: ApiStreamAssistantContentChunk,
): ApiMessage {
	const responseId = handler.getResponseId?.()
	const reasoningData = handler.getEncryptedContent?.()
	const thoughtSignature = handler.getThoughtSignature?.()
	const thoughtSignatureOrigin = handler.getThoughtSignatureOrigin?.()
	const reasoningDetails = handler.getReasoningDetails?.()

	const modelId = getModelId(apiConfiguration)
	const apiProvider = apiConfiguration.apiProvider
	const apiProtocol = getApiProtocol(
		apiProvider && !isRetiredProvider(apiProvider) ? apiProvider : undefined,
		modelId,
	)
	const isAnthropicProtocol = apiProtocol === "anthropic"

	const messageWithTs: any = {
		...message,
		messageId: crypto.randomUUID(),
		...(responseId ? { id: responseId } : {}),
		ts: Date.now(),
	}

	if (assistantContent && assistantContent.provider === apiProvider) {
		const content = restoreAssistantContent(message.content, assistantContent.content)
		if (content) {
			return { ...messageWithTs, content, assistantContentProvider: assistantContent.provider }
		}
	}

	if (reasoningDetails) {
		messageWithTs.reasoning_details = reasoningDetails
	}

	if (isAnthropicProtocol && reasoning && thoughtSignature && !reasoningDetails) {
		const thinkingBlock = {
			type: "thinking",
			thinking: reasoning,
			signature: thoughtSignature,
		}

		prependContentBlock(messageWithTs, thinkingBlock)
	} else if (reasoning && !reasoningDetails) {
		// The original Task.ts also duck-typed getSummary?.(), but no provider implements it.
		// Keep the explicit empty summary to preserve the existing reasoning-block wire shape.
		const reasoningBlock = {
			type: "reasoning",
			text: reasoning,
			summary: [] as any[],
			// A visible summary must not discard the encrypted state needed for continuation.
			...(reasoningData?.encrypted_content
				? {
						encrypted_content: reasoningData.encrypted_content,
						...(reasoningData.id ? { id: reasoningData.id } : {}),
					}
				: {}),
		}

		prependContentBlock(messageWithTs, reasoningBlock)
	} else if (reasoningData?.encrypted_content) {
		const reasoningBlock = {
			type: "reasoning",
			summary: [] as any[],
			encrypted_content: reasoningData.encrypted_content,
			...(reasoningData.id ? { id: reasoningData.id } : {}),
		}

		prependContentBlock(messageWithTs, reasoningBlock)
	}

	if (thoughtSignature && !isAnthropicProtocol) {
		const thoughtSignatureBlock = {
			type: "thoughtSignature",
			thoughtSignature,
			...(thoughtSignatureOrigin ? { origin: thoughtSignatureOrigin } : {}),
		}

		appendContentBlock(messageWithTs, thoughtSignatureBlock)
	}

	return messageWithTs
}

function prepareUserMessage(message: Anthropic.MessageParam, apiConversationHistory: ApiMessage[]): ApiMessage {
	const effectiveHistoryForValidation = getEffectiveApiHistory(apiConversationHistory)
	const lastEffective = effectiveHistoryForValidation[effectiveHistoryForValidation.length - 1]
	const historyForValidation = lastEffective?.role === "assistant" ? effectiveHistoryForValidation : []

	let messageToAdd = message
	if (lastEffective?.role !== "assistant" && Array.isArray(message.content)) {
		messageToAdd = {
			...message,
			content: message.content.map((block) =>
				block.type === "tool_result"
					? {
							type: "text" as const,
							text: `Tool result:\n${typeof block.content === "string" ? block.content : JSON.stringify(block.content)}`,
						}
					: block,
			),
		}
	}

	const validatedMessage = validateAndFixToolResultIds(messageToAdd, historyForValidation)
	return { ...validatedMessage, messageId: crypto.randomUUID(), ts: Date.now() }
}

function prependContentBlock(message: any, block: any): void {
	if (typeof message.content === "string") {
		message.content = [block, { type: "text", text: message.content } satisfies Anthropic.Messages.TextBlockParam]
	} else if (Array.isArray(message.content)) {
		message.content = [block, ...message.content]
	} else if (!message.content) {
		message.content = [block]
	}
}

function appendContentBlock(message: any, block: any): void {
	if (typeof message.content === "string") {
		message.content = [{ type: "text", text: message.content } satisfies Anthropic.Messages.TextBlockParam, block]
	} else if (Array.isArray(message.content)) {
		message.content = [...message.content, block]
	} else if (!message.content) {
		message.content = [block]
	}
}
