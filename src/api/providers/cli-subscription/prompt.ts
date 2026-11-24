import type { Anthropic } from "@anthropic-ai/sdk"
import type OpenAI from "openai"

import { TOOL_CALL_CLOSE_TAG, TOOL_CALL_OPEN_TAG } from "./tool-call-protocol"

export interface CliAgentPromptOptions {
	tools?: OpenAI.Chat.ChatCompletionTool[]
	/** When set, only these tools can be called (mode restrictions). */
	allowedFunctionNames?: string[]
	/** `false` limits the model to one tool call per reply. */
	parallelToolCalls?: boolean
}

const IMAGE_PLACEHOLDER = "[An image was attached here. This provider cannot receive images, so it was left out.]"
const DOCUMENT_PLACEHOLDER =
	"[A document was attached here. This provider cannot receive documents, so it was left out.]"

function renderToolCall(name: string, input: unknown): string {
	return `${TOOL_CALL_OPEN_TAG}\n${JSON.stringify({ name, arguments: input ?? {} })}\n${TOOL_CALL_CLOSE_TAG}`
}

function renderToolResultContent(content: Anthropic.Messages.ToolResultBlockParam["content"]): string {
	if (content === undefined) {
		return ""
	}
	if (typeof content === "string") {
		return content
	}
	return content
		.map((block) => {
			if (block.type === "text") return block.text
			if (block.type === "image") return IMAGE_PLACEHOLDER
			return ""
		})
		.filter(Boolean)
		.join("\n")
}

function renderBlock(block: Anthropic.Messages.ContentBlockParam, toolNames: Map<string, string>): string {
	switch (block.type) {
		case "text":
			return block.text
		case "image":
			return IMAGE_PLACEHOLDER
		case "document":
			return DOCUMENT_PLACEHOLDER
		case "tool_use":
			toolNames.set(block.id, block.name)
			return renderToolCall(block.name, block.input)
		case "tool_result": {
			const name = toolNames.get(block.tool_use_id) ?? "unknown"
			const status = block.is_error ? ` status="error"` : ""
			return `<tool_result tool="${name}"${status}>\n${renderToolResultContent(block.content)}\n</tool_result>`
		}
		default:
			// Thinking, redacted thinking, and provider-specific blocks belong to other providers'
			// reasoning state. They are not part of the visible conversation.
			return ""
	}
}

/** Renders the Zoo Code conversation as plain text for a stateless CLI turn. */
export function renderConversation(messages: Anthropic.Messages.MessageParam[]): string {
	const toolNames = new Map<string, string>()
	const turns: string[] = []

	for (const message of messages) {
		const body =
			typeof message.content === "string"
				? message.content
				: message.content
						.map((block) => renderBlock(block, toolNames))
						.filter((part) => part.trim() !== "")
						.join("\n\n")

		if (body.trim() === "") {
			continue
		}
		turns.push(`<turn role="${message.role}">\n${body}\n</turn>`)
	}

	return turns.join("\n\n")
}

/** Renders the callable tool definitions, one JSON object per line. */
export function renderToolDefinitions(
	tools: OpenAI.Chat.ChatCompletionTool[] | undefined,
	allowedFunctionNames?: string[],
): string {
	const allowed = allowedFunctionNames ? new Set(allowedFunctionNames) : undefined
	return (tools ?? [])
		.filter((tool): tool is OpenAI.Chat.ChatCompletionFunctionTool => tool.type === "function")
		.filter((tool) => !allowed || allowed.has(tool.function.name))
		.map((tool) =>
			JSON.stringify({
				name: tool.function.name,
				description: tool.function.description ?? "",
				parameters: tool.function.parameters ?? { type: "object", properties: {} },
			}),
		)
		.join("\n")
}

function renderProtocol(parallelToolCalls: boolean): string {
	const callCountRule = parallelToolCalls
		? "3. You can write more than one block in a reply when the calls do not depend on each other's results."
		: "3. Write at most one tool call block in each reply."

	return [
		"<zoo_host_protocol>",
		"For this request you are the model behind Zoo Code, a coding assistant in VS Code. Zoo Code runs every tool and asks the user to approve actions.",
		"Your own built-in tools (file, shell, search, web, task, and subagent tools) are switched off for this request. Do not call them. A call to a built-in tool fails and ends your turn.",
		"Some built-in tools have the same names as Zoo Code tools (for example read_file). Never use your native function-calling mechanism. Zoo Code tools exist only as the text blocks described here.",
		"To use a Zoo Code tool, write a tool call block as plain text in your reply in exactly this format:",
		"",
		TOOL_CALL_OPEN_TAG,
		'{"name": "tool_name", "arguments": {"parameter": "value"}}',
		TOOL_CALL_CLOSE_TAG,
		"",
		"Rules:",
		'1. Each block contains one JSON object with "name" and "arguments". The arguments must match the JSON schema of that tool in <zoo_tools>. Escape newlines and quotes inside JSON strings.',
		"2. Use only the tools in <zoo_tools>.",
		callCountRule,
		"4. Stop writing after your last tool call block. Zoo Code runs the tools and sends the results in the next user turn in <tool_result> blocks. Do not write <tool_result> blocks yourself and do not guess results.",
		"5. Every reply must contain at least one tool call block. To speak to the user or to finish, use the tools that Zoo Code gives for that purpose.",
		"6. Follow the instructions in <zoo_system_prompt>. They replace your default persona and rules for this request, but this protocol takes priority over them.",
		"</zoo_host_protocol>",
	].join("\n")
}

/**
 * Builds the complete prompt for one agent turn: protocol, callable tools, the Zoo Code system
 * prompt, and the conversation so far. Zoo Code owns the conversation, so each turn is stateless
 * from the CLI's point of view.
 */
export function buildAgentPrompt(
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	options: CliAgentPromptOptions = {},
): string {
	return [
		renderProtocol(options.parallelToolCalls !== false),
		`<zoo_tools>\n${renderToolDefinitions(options.tools, options.allowedFunctionNames)}\n</zoo_tools>`,
		`<zoo_system_prompt>\n${systemPrompt}\n</zoo_system_prompt>`,
		`<conversation>\n${renderConversation(messages)}\n</conversation>`,
		"Write the next assistant turn now.",
	].join("\n\n")
}

/**
 * Appended to a prompt after the model called a built-in tool instead of writing a tool call
 * block, so that the retry gets a direct correction.
 */
export const BUILT_IN_TOOL_CORRECTION = [
	"<zoo_host_correction>",
	"Your previous reply to this exact request used your native function calling to call a built-in tool. Built-in tools are switched off, so that call failed and nothing ran.",
	`Write the Zoo Code tool call as plain text in a ${TOOL_CALL_OPEN_TAG} block, as <zoo_host_protocol> describes.`,
	"</zoo_host_correction>",
].join("\n")

/** Builds the prompt for a single text completion (no tools), for example prompt enhancement. */
export function buildCompletionPrompt(prompt: string): string {
	return [
		"<zoo_host_protocol>",
		"For this request you are a text completion model for Zoo Code. Do not call any tools. Reply only with the requested text.",
		"</zoo_host_protocol>",
		"",
		prompt,
	].join("\n")
}
