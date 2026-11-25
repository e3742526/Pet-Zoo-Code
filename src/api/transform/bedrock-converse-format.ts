import { Anthropic } from "@anthropic-ai/sdk"
import { ConversationRole, Message, ContentBlock } from "@aws-sdk/client-bedrock-runtime"
import { sanitizeOpenAiCallId } from "../../utils/tool-id"

interface BedrockMessageContent {
	type: "text" | "image" | "video" | "tool_use" | "tool_result"
	text?: string
	source?: {
		type: "base64"
		data: string | Uint8Array // string for Anthropic, Uint8Array for Bedrock
		media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
	}
	// Video specific fields
	format?: string
	s3Location?: {
		uri: string
		bucketOwner?: string
	}
	// Tool use and result fields
	toolUseId?: string
	name?: string
	input?: any
	output?: any // Used for tool_result type
}

export function convertToBedrockConverseMessages(
	anthropicMessages: Anthropic.Messages.MessageParam[],
	preserveReasoning = false,
): Message[] {
	return anthropicMessages.map((anthropicMessage, index) => {
		// Map Anthropic roles to Bedrock roles
		const role: ConversationRole = anthropicMessage.role === "assistant" ? "assistant" : "user"

		if (typeof anthropicMessage.content === "string") {
			return {
				role,
				content: [
					{
						text: anthropicMessage.content,
					},
				] as ContentBlock[],
			}
		}

		const blocks = anthropicMessage.content
		const nextMessage = anthropicMessages[index + 1]
		const replayReasoning =
			preserveReasoning &&
			role === "assistant" &&
			nextMessage?.role === "user" &&
			Array.isArray(nextMessage.content) &&
			nextMessage.content.some(
				(result) =>
					result.type === "tool_result" &&
					blocks.some((call) => call.type === "tool_use" && call.id === result.tool_use_id),
			)
		const convertedBlocks = blocks.map((block): ContentBlock | undefined => {
			// Saved history also uses block types outside the Anthropic SDK union.
			const blockType: string = block.type
			if (blockType === "reasoning" || block.type === "thinking") {
				const text = block.type === "thinking" ? block.thinking : "text" in block ? block.text : undefined
				if (replayReasoning && typeof text === "string" && text.trim()) {
					return { reasoningContent: { reasoningText: { text } } }
				}
				return undefined
			}
			if (blockType === "redacted_thinking" || blockType === "thoughtSignature") {
				return undefined
			}

			const messageBlock = block as BedrockMessageContent & {
				id?: string
				tool_use_id?: string
				content?: string | Array<{ type: string; text: string }>
				output?: string | Array<{ type: string; text: string }>
			}

			if (messageBlock.type === "text") {
				return {
					text: messageBlock.text || "",
				} as ContentBlock
			}

			if (messageBlock.type === "image" && messageBlock.source) {
				// Convert base64 string to byte array if needed
				let byteArray: Uint8Array
				if (typeof messageBlock.source.data === "string") {
					const binaryString = atob(messageBlock.source.data)
					byteArray = new Uint8Array(binaryString.length)
					for (let i = 0; i < binaryString.length; i++) {
						byteArray[i] = binaryString.charCodeAt(i)
					}
				} else {
					byteArray = messageBlock.source.data
				}

				// Extract format from media_type (e.g., "image/jpeg" -> "jpeg")
				const format = messageBlock.source.media_type.split("/")[1]
				if (!["png", "jpeg", "gif", "webp"].includes(format)) {
					throw new Error(`Unsupported image format: ${format}`)
				}

				return {
					image: {
						format: format as "png" | "jpeg" | "gif" | "webp",
						source: {
							bytes: byteArray,
						},
					},
				} as ContentBlock
			}

			if (messageBlock.type === "tool_use") {
				// Native-only: keep input as JSON object for Bedrock's toolUse format
				return {
					toolUse: {
						toolUseId: sanitizeOpenAiCallId(messageBlock.id || ""),
						name: messageBlock.name || "",
						input: messageBlock.input || {},
					},
				} as ContentBlock
			}

			if (messageBlock.type === "tool_result") {
				// Handle content field - can be string or array (native tool format)
				if (messageBlock.content) {
					// Content is a string
					if (typeof messageBlock.content === "string") {
						return {
							toolResult: {
								toolUseId: sanitizeOpenAiCallId(messageBlock.tool_use_id || ""),
								content: [
									{
										text: messageBlock.content,
									},
								],
								status: "success",
							},
						} as ContentBlock
					}
					// Content is an array of content blocks
					if (Array.isArray(messageBlock.content)) {
						return {
							toolResult: {
								toolUseId: sanitizeOpenAiCallId(messageBlock.tool_use_id || ""),
								content: messageBlock.content.map((item) => ({
									text: typeof item === "string" ? item : item.text || String(item),
								})),
								status: "success",
							},
						} as ContentBlock
					}
				}

				// Fall back to output handling if content is not available
				if (messageBlock.output && typeof messageBlock.output === "string") {
					return {
						toolResult: {
							toolUseId: sanitizeOpenAiCallId(messageBlock.tool_use_id || ""),
							content: [
								{
									text: messageBlock.output,
								},
							],
							status: "success",
						},
					} as ContentBlock
				}
				// Handle array of content blocks if output is an array
				if (Array.isArray(messageBlock.output)) {
					return {
						toolResult: {
							toolUseId: sanitizeOpenAiCallId(messageBlock.tool_use_id || ""),
							content: messageBlock.output.map((part) => {
								if (typeof part === "object" && "text" in part) {
									return { text: part.text }
								}
								// Skip images in tool results as they're handled separately
								if (typeof part === "object" && "type" in part && part.type === "image") {
									return { text: "(see following message for image)" }
								}
								return { text: String(part) }
							}),
							status: "success",
						},
					} as ContentBlock
				}

				// Default case
				return {
					toolResult: {
						toolUseId: sanitizeOpenAiCallId(messageBlock.tool_use_id || ""),
						content: [
							{
								text: String(messageBlock.output || ""),
							},
						],
						status: "success",
					},
				} as ContentBlock
			}

			if (messageBlock.type === "video") {
				const videoContent = messageBlock.s3Location
					? {
							s3Location: {
								uri: messageBlock.s3Location.uri,
								bucketOwner: messageBlock.s3Location.bucketOwner,
							},
						}
					: messageBlock.source

				return {
					video: {
						format: "mp4", // Default to mp4, adjust based on actual format if needed
						source: videoContent,
					},
				} as ContentBlock
			}

			// Default case for unknown block types
			return {
				text: "[Unknown Block Type]",
			} as ContentBlock
		})

		const content = convertedBlocks.filter((block) => block !== undefined)
		// Keep the message position stable for the prompt cache and supply a valid text block.
		return {
			role,
			content: content.length === 0 && blocks.length > 0 ? [{ text: "[Reasoning omitted]" }] : content,
		}
	})
}
