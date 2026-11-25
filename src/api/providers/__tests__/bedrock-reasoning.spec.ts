// npx vitest api/providers/__tests__/bedrock-reasoning.test.ts

import type { Anthropic } from "@anthropic-ai/sdk"

import { AwsBedrockHandler } from "../bedrock"
import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime"
import { logger } from "../../../utils/logging"

import { clearAllMocks } from "../../../test-utils/reset"
import { asyncStreamFrom, collectStream } from "../../../test-utils/stream"
import { providerIdentifiers } from "@roo-code/types/provider-identifiers"

// Mock the AWS SDK
vi.mock("@aws-sdk/client-bedrock-runtime")
vi.mock("../../../utils/logging")

// Store the command payload for verification
let capturedPayload: any = null

describe("AwsBedrockHandler - Extended Thinking", () => {
	let handler: AwsBedrockHandler
	let mockSend: ReturnType<typeof vi.fn>

	beforeEach(() => {
		capturedPayload = null
		mockSend = vi.fn()

		// Mock ConverseStreamCommand to capture the payload
		;(ConverseStreamCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (payload) {
			capturedPayload = payload
			return {
				input: payload,
			}
		})
		;(BedrockRuntimeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
			return {
				send: mockSend,
				config: { region: "us-east-1" },
			}
		})
		;(logger.info as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {})
		;(logger.error as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {})
	})

	afterEach(() => {
		clearAllMocks()
	})

	describe("Saved reasoning", () => {
		it.each([
			{ model: "moonshot.kimi-k2-thinking", toolContinuation: true, replaysReasoning: true },
			{ model: "minimax.minimax-m2", toolContinuation: true, replaysReasoning: true },
			{ model: "moonshot.kimi-k2-thinking", toolContinuation: false, replaysReasoning: false },
			{ model: "anthropic.claude-sonnet-4-20250514-v1:0", toolContinuation: true, replaysReasoning: false },
		])(
			"formats $model reasoning when toolContinuation is $toolContinuation",
			async ({ model, toolContinuation, replaysReasoning }) => {
				handler = new AwsBedrockHandler({ apiModelId: model, awsRegion: "us-east-1" })
				mockSend.mockResolvedValue({ stream: asyncStreamFrom([]) })
				const reasoningText = "  Check the file first.\n"
				// Task history can carry the extension's reasoning block, outside the SDK union.
				const savedReasoning = {
					type: "reasoning",
					text: reasoningText,
					summary: [],
				} as unknown as Anthropic.Messages.ContentBlockParam
				const assistantContent: Anthropic.Messages.ContentBlockParam[] = [
					savedReasoning,
					{ type: "thinking", thinking: "Check the previous result.", signature: "foreign-signature" },
					{ type: "redacted_thinking", data: "foreign-data" },
					{ type: "text", text: "I'll check." },
				]
				let nextUserContent: Anthropic.Messages.MessageParam["content"] = "Here is a new task."
				if (toolContinuation) {
					assistantContent.push({
						type: "tool_use",
						id: "read-1",
						name: "read_file",
						input: { path: "file.txt" },
					})
					nextUserContent = [{ type: "tool_result", tool_use_id: "read-1", content: "File contents" }]
				}
				await collectStream(
					handler.createMessage("System prompt", [
						{ role: "user", content: "Read the file." },
						{ role: "assistant", content: assistantContent },
						{ role: "user", content: nextUserContent },
					]),
				)

				const messages = vi.mocked(ConverseStreamCommand).mock.lastCall?.[0].messages
				expect(messages?.[1]?.content).toEqual([
					...(replaysReasoning
						? [
								{ reasoningContent: { reasoningText: { text: reasoningText } } },
								{ reasoningContent: { reasoningText: { text: "Check the previous result." } } },
							]
						: []),
					{ text: "I'll check." },
					...(toolContinuation
						? [{ toolUse: { toolUseId: "read-1", name: "read_file", input: { path: "file.txt" } } }]
						: []),
				])
				expect(messages?.[2]?.content).toEqual(
					toolContinuation
						? [
								{
									toolResult: {
										toolUseId: "read-1",
										content: [{ text: "File contents" }],
										status: "success",
									},
								},
							]
						: [{ text: "Here is a new task." }],
				)
			},
		)

		it("sends the conversation after skipping standalone encrypted reasoning from history", async () => {
			handler = new AwsBedrockHandler({ apiModelId: "moonshot.kimi-k2-thinking", awsRegion: "us-east-1" })
			mockSend.mockResolvedValue({ stream: asyncStreamFrom([]) })
			// The task can pass a roleless reasoning item retained from a different provider.
			const history = [
				{ role: "user", content: "First question" },
				{ type: "reasoning", encrypted_content: "foreign-data", summary: [] },
				{ role: "assistant", content: "First answer" },
				{ role: "user", content: "Next question" },
			] as unknown as Anthropic.Messages.MessageParam[]
			await collectStream(handler.createMessage("System prompt", history))

			expect(vi.mocked(ConverseStreamCommand).mock.lastCall?.[0].messages).toEqual([
				{ role: "user", content: [{ text: "First question" }] },
				{ role: "assistant", content: [{ text: "First answer" }] },
				{ role: "user", content: [{ text: "Next question" }] },
			])
		})
	})

	describe("Extended Thinking Support", () => {
		it("should include thinking parameter for Claude Sonnet 4 when reasoning is enabled", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: providerIdentifiers.bedrock,
				apiModelId: "anthropic.claude-sonnet-4-20250514-v1:0",
				awsRegion: "us-east-1",
				enableReasoningEffort: true,
				modelMaxTokens: 8192,
				modelMaxThinkingTokens: 4096,
			})

			// Mock the stream response
			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield {
						messageStart: { role: "assistant" },
					}
					yield {
						contentBlockStart: {
							content_block: { type: "thinking", thinking: "Let me think..." },
							contentBlockIndex: 0,
						},
					}
					yield {
						contentBlockDelta: {
							delta: { type: "thinking_delta", thinking: " about this problem." },
						},
					}
					yield {
						contentBlockStart: {
							start: { text: "Here's the answer:" },
							contentBlockIndex: 1,
						},
					}
					yield {
						metadata: {
							usage: { inputTokens: 100, outputTokens: 50 },
						},
					}
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test message" }]
			const stream = handler.createMessage("System prompt", messages)

			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify the command was called with the correct payload
			expect(mockSend).toHaveBeenCalledTimes(1)
			expect(capturedPayload).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields.thinking).toEqual({
				type: "enabled",
				budget_tokens: 4096, // Uses the full modelMaxThinkingTokens value
			})

			// Verify reasoning chunks were yielded
			const reasoningChunks = chunks.filter((c) => c.type === "reasoning")
			expect(reasoningChunks).toHaveLength(2)
			expect(reasoningChunks[0].text).toBe("Let me think...")
			expect(reasoningChunks[1].text).toBe(" about this problem.")

			// Verify that topP is NOT present when thinking is enabled
			expect(capturedPayload.inferenceConfig).not.toHaveProperty("topP")
		})

		it("should pass thinking parameters from metadata", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: providerIdentifiers.bedrock,
				apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
				awsRegion: "us-east-1",
			})

			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } }
					yield { metadata: { usage: { inputTokens: 100, outputTokens: 50 } } }
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test message" }]
			const metadata = {
				taskId: "test-task",
				thinking: {
					enabled: true,
					maxTokens: 16384,
					maxThinkingTokens: 8192,
				},
			}

			const stream = handler.createMessage("System prompt", messages, metadata)
			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify the thinking parameter was passed correctly
			expect(mockSend).toHaveBeenCalledTimes(1)
			expect(capturedPayload).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields.thinking).toEqual({
				type: "enabled",
				budget_tokens: 8192,
			})

			// Verify that topP is NOT present when thinking is enabled via metadata
			expect(capturedPayload.inferenceConfig).not.toHaveProperty("topP")
		})

		it("should log when extended thinking is enabled", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: providerIdentifiers.bedrock,
				apiModelId: "anthropic.claude-opus-4-20250514-v1:0",
				awsRegion: "us-east-1",
				enableReasoningEffort: true,
				modelMaxThinkingTokens: 5000,
			})

			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } }
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test" }]
			const stream = handler.createMessage("System prompt", messages)

			for await (const _chunk of stream) {
				// consume stream
			}

			// Verify logging
			expect(logger.info).toHaveBeenCalledWith(
				expect.stringContaining("Extended thinking enabled"),
				expect.objectContaining({
					ctx: "bedrock",
					modelId: "anthropic.claude-opus-4-20250514-v1:0",
				}),
			)
		})

		it("should not include topP when thinking is disabled (global removal)", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: providerIdentifiers.bedrock,
				apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
				awsRegion: "us-east-1",
				// Note: no enableReasoningEffort = true, so thinking is disabled
			})

			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } }
					yield {
						contentBlockStart: {
							start: { text: "Hello" },
							contentBlockIndex: 0,
						},
					}
					yield {
						contentBlockDelta: {
							delta: { text: " world" },
						},
					}
					yield { metadata: { usage: { inputTokens: 100, outputTokens: 50 } } }
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test message" }]
			const stream = handler.createMessage("System prompt", messages)

			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify that topP is NOT present for any model (removed globally)
			expect(mockSend).toHaveBeenCalledTimes(1)
			expect(capturedPayload).toBeDefined()
			expect(capturedPayload.inferenceConfig).not.toHaveProperty("topP")

			// Verify that additionalModelRequestFields contains fine-grained-tool-streaming for Claude models
			expect(capturedPayload.additionalModelRequestFields).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields.anthropic_beta).toContain(
				"fine-grained-tool-streaming-2025-05-14",
			)
		})

		it("should enable reasoning when enableReasoningEffort is true in settings", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: providerIdentifiers.bedrock,
				apiModelId: "anthropic.claude-sonnet-4-20250514-v1:0",
				awsRegion: "us-east-1",
				enableReasoningEffort: true, // This should trigger reasoning
				modelMaxThinkingTokens: 4096,
			})

			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } }
					yield {
						contentBlockStart: {
							content_block: { type: "thinking", thinking: "Let me think..." },
							contentBlockIndex: 0,
						},
					}
					yield {
						contentBlockDelta: {
							delta: { type: "thinking_delta", thinking: " about this problem." },
						},
					}
					yield { metadata: { usage: { inputTokens: 100, outputTokens: 50 } } }
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test message" }]
			const stream = handler.createMessage("System prompt", messages)

			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify thinking was enabled via settings
			expect(mockSend).toHaveBeenCalledTimes(1)
			expect(capturedPayload).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields.thinking).toEqual({
				type: "enabled",
				budget_tokens: 4096,
			})

			// Verify that topP is NOT present when thinking is enabled via settings
			expect(capturedPayload.inferenceConfig).not.toHaveProperty("topP")

			// Verify reasoning chunks were yielded
			const reasoningChunks = chunks.filter((c) => c.type === "reasoning")
			expect(reasoningChunks).toHaveLength(2)
			expect(reasoningChunks[0].text).toBe("Let me think...")
			expect(reasoningChunks[1].text).toBe(" about this problem.")
		})

		it("should support API key authentication", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: providerIdentifiers.bedrock,
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsRegion: "us-east-1",
				awsUseApiKey: true,
				awsApiKey: "test-api-key-token",
			})

			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } }
					yield {
						contentBlockStart: {
							start: { text: "Hello from API key auth" },
							contentBlockIndex: 0,
						},
					}
					yield { metadata: { usage: { inputTokens: 100, outputTokens: 50 } } }
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test message" }]
			const stream = handler.createMessage("System prompt", messages)

			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify the client was created with API key token
			expect(BedrockRuntimeClient).toHaveBeenCalledWith(
				expect.objectContaining({
					region: "us-east-1",
					token: { token: "test-api-key-token" },
					authSchemePreference: ["httpBearerAuth"],
				}),
			)

			// Verify the stream worked correctly
			expect(mockSend).toHaveBeenCalledTimes(1)
			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Hello from API key auth")
		})
	})
})
