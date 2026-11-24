import * as path from "path"

import type { Anthropic } from "@anthropic-ai/sdk"

import { antigravityDefaultModelId, antigravityDefaultModelInfo, antigravityModels } from "@roo-code/types"

import { collectStream } from "../../../test-utils/stream"
import { ANTIGRAVITY_RESTRICTION_FLAGS, AntigravityHandler } from "../antigravity"
import { createFakeCli, type FakeCli } from "../cli-subscription/__tests__/fake-cli"

const CONVERSATION = "f1f78d6f-bfd3-40e7-a932-87b90ae17a99"
const init = { event: "init", conversation_id: CONVERSATION, init: { model: "gemini-3.8-flash-low", tools: [] } }
const responseDelta = (text: string) => ({
	event: "step_update",
	step_update: {
		conversation_id: CONVERSATION,
		step_index: 1,
		state: "ACTIVE",
		step_type: "agent_response",
		text_delta: text,
	},
})
const result = (status: string, response = "", extra: Record<string, unknown> = {}) => ({
	event: "result",
	result: {
		conversation_id: CONVERSATION,
		status,
		response,
		usage: { input_tokens: 300, output_tokens: 35, thinking_tokens: 0, cache_read_tokens: 22000 },
		...extra,
	},
})

const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "/help read notes.txt" }]

describe.skipIf(process.platform === "win32")("AntigravityHandler", () => {
	let cli: FakeCli

	beforeEach(async () => {
		cli = await createFakeCli()
	})

	afterEach(async () => {
		await cli.dispose()
	})

	const handler = (options: Partial<ConstructorParameters<typeof AntigravityHandler>[0]> = {}) =>
		new AntigravityHandler({ antigravityExecutablePath: cli.executable, ...options })

	it("turns streamed text into a tool call and counts cached input once", async () => {
		await cli.script({
			lines: [
				init,
				responseDelta('<zoo_tool_call>\n{"name": "read_file"'),
				responseDelta(', "arguments": {"path": "notes.txt"}}\n</zoo_tool_call>\n'),
				result("SUCCESS", "ignored because text was streamed"),
			],
		})

		const chunks = await collectStream(handler().createMessage("SYSTEM", messages, { taskId: "t1" }))

		expect(chunks).toEqual([
			{
				type: "tool_call",
				id: expect.stringMatching(/^call_/),
				name: "read_file",
				arguments: '{"path":"notes.txt"}',
			},
			{ type: "text", text: "\n" },
			{ type: "usage", inputTokens: 22300, outputTokens: 35, cacheReadTokens: 22000, totalCost: 0 },
		])
	})

	it("sends the prompt as one stream-json message on stdin with read-only flags", async () => {
		await cli.script({ lines: [init, result("SUCCESS", "ok")] })

		await collectStream(
			handler({ apiModelId: "claude-sonnet-5-5-high" }).createMessage("SYSTEM PROMPT", messages, {
				taskId: "t1",
			}),
		)
		const record = await cli.record()

		expect(record.argv).toEqual([
			"--input-format",
			"stream-json",
			"--output-format",
			"stream-json",
			"--model",
			"claude-sonnet-5-5-high",
			...ANTIGRAVITY_RESTRICTION_FLAGS,
		])
		expect(JSON.parse(record.argv[record.argv.indexOf("--settings") + 1])).toEqual({
			toolPermission: "request-review",
		})
		expect(record.argv).toContain("--disable-slash-commands")

		expect(record.stdin.endsWith("\n")).toBe(true)
		const message = JSON.parse(record.stdin)
		expect(message.event).toBe("user")
		expect(message.message.content).toContain("SYSTEM PROMPT")
		expect(message.message.content).toContain("/help read notes.txt")
		expect(path.basename(record.cwd)).toBe("antigravity")
	})

	it("explains a failed turn", async () => {
		await cli.script({ lines: [init, result("FAILURE", "", { error: "RESOURCE_EXHAUSTED: quota" })] })
		await expect(collectStream(handler().createMessage("S", messages, { taskId: "t1" }))).rejects.toThrow(
			/Antigravity: the turn ended with status "FAILURE": RESOURCE_EXHAUSTED: quota[\s\S]*allowance/,
		)
	})

	it("uses the AGY_ERROR line when the CLI exits without a result", async () => {
		await cli.script({
			lines: [init],
			stderr: 'AGY_ERROR: {"short_error":"model unavailable: gemini-x"}\n',
			exitCode: 1,
		})
		await expect(collectStream(handler().createMessage("S", messages, { taskId: "t1" }))).rejects.toThrow(
			/Antigravity: model unavailable: gemini-x\.[\s\S]*agy models/,
		)
	})
})

describe("AntigravityHandler.getModel", () => {
	it("uses the default model when none is set", () => {
		const model = new AntigravityHandler({}).getModel()
		expect(model.id).toBe(antigravityDefaultModelId)
		expect(model.info).toBe(antigravityModels[antigravityDefaultModelId])
		expect(model.reasoningEffort).toBeUndefined()
	})

	it("keeps a custom model ID with default metadata", () => {
		const model = new AntigravityHandler({ apiModelId: "gemini-5-preview" }).getModel()
		expect(model.id).toBe("gemini-5-preview")
		expect(model.info).toBe(antigravityDefaultModelInfo)
	})
})
