import { Anthropic } from "@anthropic-ai/sdk"

import { prepareAnthropicMessages, VALID_ANTHROPIC_BLOCK_TYPES } from "../anthropic-filter"

describe("anthropic-filter", () => {
	describe("VALID_ANTHROPIC_BLOCK_TYPES", () => {
		it("should contain all valid Anthropic types", () => {
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("text")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("image")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("tool_use")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("tool_result")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("thinking")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("redacted_thinking")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("document")).toBe(true)
		})

		it("should not contain internal or provider-specific types", () => {
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("reasoning")).toBe(false)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("thoughtSignature")).toBe(false)
		})
	})

	describe("prepareAnthropicMessages", () => {
		const call = (id: string): Anthropic.Messages.ToolUseBlockParam => ({
			type: "tool_use",
			id,
			name: "read_file",
			input: {},
		})
		const result = (id: string, content: string): Anthropic.Messages.ToolResultBlockParam => ({
			type: "tool_result",
			tool_use_id: id,
			content,
		})

		it("keeps matching results across consecutive messages of either role", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Read both files." },
				{ role: "assistant", content: [call("first")] },
				{ role: "assistant", content: [call("second")] },
				{ role: "user", content: [result("first", "first file")] },
				{ role: "user", content: [result("second", "second file")] },
				{ role: "user", content: "Summarize them." },
			]

			expect(prepareAnthropicMessages(messages)).toEqual(messages)
		})

		it("moves a result ahead of earlier text in the same user turn", () => {
			const assistant: Anthropic.Messages.MessageParam = { role: "assistant", content: [call("read")] }
			const read = result("read", "actual result")
			const messages: Anthropic.Messages.MessageParam[] = [
				assistant,
				{ role: "user", content: "Summarize the file." },
				{ role: "user", content: [read] },
			]

			expect(prepareAnthropicMessages(messages)).toEqual([
				assistant,
				{ role: "user", content: [read, { type: "text", text: "Summarize the file." }] },
			])
		})

		it("drops stale results across turn boundaries and keeps the trailing assistant message", () => {
			const assistant: Anthropic.Messages.MessageParam = { role: "assistant", content: [call("old")] }
			const successful: Anthropic.Messages.MessageParam = { role: "user", content: [result("old", "real data")] }
			const nextAssistant: Anthropic.Messages.MessageParam = { role: "assistant", content: "Done." }
			const question: Anthropic.Messages.TextBlockParam = { type: "text", text: "Try another file." }
			const trailing: Anthropic.Messages.MessageParam = { role: "assistant", content: [call("next")] }
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: [result("removed", "removed by truncation")] },
				assistant,
				successful,
				nextAssistant,
				{ role: "user", content: [result("old", "stale result"), question] },
				trailing,
			]

			expect(prepareAnthropicMessages(messages)).toEqual([
				assistant,
				successful,
				nextAssistant,
				{ role: "user", content: [question] },
				trailing,
			])
		})

		it("should pass through messages with string content", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there!" },
			]

			const result = prepareAnthropicMessages(messages)

			expect(result).toEqual(messages)
		})

		it("should pass through messages with valid Anthropic blocks", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "Hi there!" }],
				},
			]

			const result = prepareAnthropicMessages(messages)

			expect(result).toEqual(messages)
		})

		it("should filter out reasoning blocks from messages", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{
					role: "assistant",
					content: [
						{ type: "reasoning" as any, text: "Internal reasoning" },
						{ type: "text", text: "Response" },
					],
				},
			]

			const result = prepareAnthropicMessages(messages)

			expect(result).toHaveLength(2)
			expect(result[1].content).toEqual([{ type: "text", text: "Response" }])
		})

		it("filters out standalone reasoning carried over from another provider", () => {
			const messages = [
				{ role: "user", content: "Hello" },
				{ type: "reasoning", encrypted_content: "opaque-state", summary: [] },
				{ role: "assistant", content: "Response" },
			]

			// Task passes its mixed conversation items using the provider's MessageParam interface.
			const result = prepareAnthropicMessages(messages as unknown as Anthropic.Messages.MessageParam[])

			expect(result).toEqual([messages[0], messages[2]])
		})

		it("should filter out thoughtSignature blocks from messages", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{
					role: "assistant",
					content: [
						{ type: "thoughtSignature", thoughtSignature: "encrypted-sig" } as any,
						{ type: "text", text: "Response" },
					],
				},
			]

			const result = prepareAnthropicMessages(messages)

			expect(result).toHaveLength(2)
			expect(result[1].content).toEqual([{ type: "text", text: "Response" }])
		})

		it("should remove messages that become empty after filtering", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{
					role: "assistant",
					content: [{ type: "reasoning" as any, text: "Only reasoning" }],
				},
				{ role: "user", content: "Continue" },
			]

			const result = prepareAnthropicMessages(messages)

			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Hello")
			expect(result[1].content).toBe("Continue")
		})

		it("should handle mixed content with multiple invalid block types", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{ type: "reasoning", text: "Reasoning" } as any,
						{ type: "text", text: "Text 1" },
						{ type: "thoughtSignature", thoughtSignature: "sig" } as any,
						{ type: "text", text: "Text 2" },
					],
				},
			]

			const result = prepareAnthropicMessages(messages)

			expect(result).toHaveLength(1)
			expect(result[0].content).toEqual([
				{ type: "text", text: "Text 1" },
				{ type: "text", text: "Text 2" },
			])
		})

		it("should filter out any unknown block types", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{ type: "unknown_future_type", data: "some data" } as any,
						{ type: "text", text: "Valid text" },
					],
				},
			]

			const result = prepareAnthropicMessages(messages)

			expect(result).toHaveLength(1)
			expect(result[0].content).toEqual([{ type: "text", text: "Valid text" }])
		})
	})
})
