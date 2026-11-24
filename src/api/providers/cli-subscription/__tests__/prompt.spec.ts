import type { Anthropic } from "@anthropic-ai/sdk"
import type OpenAI from "openai"

import { buildAgentPrompt, buildCompletionPrompt, renderConversation, renderToolDefinitions } from "../prompt"
import { ToolCallStreamParser } from "../tool-call-protocol"

const tools: OpenAI.Chat.ChatCompletionTool[] = [
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read a file",
			parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		},
	},
	{
		type: "function",
		function: {
			name: "write_to_file",
			description: "Write a file",
			parameters: { type: "object", properties: {} },
		},
	},
]

const conversation: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: "Read a.ts" },
	{
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "private reasoning", signature: "sig" },
			{ type: "text", text: "Reading it." },
			{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } },
		],
	},
	{
		role: "user",
		content: [
			{ type: "tool_result", tool_use_id: "call_1", content: [{ type: "text", text: "export {}" }] },
			{ type: "tool_result", tool_use_id: "call_missing", content: "boom", is_error: true },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
		],
	},
]

describe("renderConversation", () => {
	const rendered = renderConversation(conversation)

	it("renders earlier tool calls in the protocol format the model must use", () => {
		const parser = new ToolCallStreamParser()
		const events = [...parser.push(rendered), ...parser.finish()]
		expect(events).toContainEqual({ type: "tool_call", name: "read_file", arguments: '{"path":"a.ts"}' })
	})

	it("labels tool results with the tool name and error status", () => {
		expect(rendered).toContain('<tool_result tool="read_file">\nexport {}\n</tool_result>')
		expect(rendered).toContain('<tool_result tool="unknown" status="error">\nboom\n</tool_result>')
	})

	it("replaces images with a note and leaves out reasoning blocks", () => {
		expect(rendered).toContain("This provider cannot receive images")
		expect(rendered).not.toContain("private reasoning")
	})

	it("wraps each message in a turn with its role", () => {
		expect(rendered.match(/<turn role="user">/g)).toHaveLength(2)
		expect(rendered.match(/<turn role="assistant">/g)).toHaveLength(1)
	})
})

describe("renderToolDefinitions", () => {
	it("renders every function tool when no restriction is given", () => {
		const lines = renderToolDefinitions(tools).split("\n")
		expect(lines.map((line) => JSON.parse(line).name)).toEqual(["read_file", "write_to_file"])
		expect(JSON.parse(lines[0]).parameters.required).toEqual(["path"])
	})

	it("renders only the allowed tools", () => {
		expect(renderToolDefinitions(tools, ["read_file"])).not.toContain("write_to_file")
	})
})

describe("buildAgentPrompt", () => {
	it("contains the protocol, tools, system prompt, and conversation in order", () => {
		const prompt = buildAgentPrompt("SYSTEM PROMPT", conversation, { tools })
		const order = ["<zoo_host_protocol>", "<zoo_tools>", "SYSTEM PROMPT", "<conversation>"].map((marker) =>
			prompt.indexOf(marker),
		)
		expect(order.every((index) => index >= 0)).toBe(true)
		expect([...order].sort((a, b) => a - b)).toEqual(order)
	})

	it.each([
		[true, "more than one block"],
		[undefined, "more than one block"],
		[false, "at most one tool call block"],
	])("states the call limit when parallelToolCalls is %s", (parallelToolCalls, expected) => {
		expect(buildAgentPrompt("", [], { tools, parallelToolCalls })).toContain(expected)
	})
})

describe("buildCompletionPrompt", () => {
	it("forbids tools and keeps the prompt text", () => {
		const prompt = buildCompletionPrompt("Improve this prompt")
		expect(prompt).toContain("Do not call any tools")
		expect(prompt.endsWith("Improve this prompt")).toBe(true)
	})
})
