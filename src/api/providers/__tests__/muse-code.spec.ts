import { existsSync, realpathSync } from "fs"
import * as os from "os"
import * as path from "path"

import type { Anthropic } from "@anthropic-ai/sdk"
import type OpenAI from "openai"

import { museCodeDefaultModelId, museCodeDefaultModelInfo, museCodeModels } from "@roo-code/types"

import { collectStream } from "../../../test-utils/stream"
import { createFakeCli, type FakeCli } from "../cli-subscription/__tests__/fake-cli"
import { MUSE_RESTRICTION_FLAGS, MuseCodeHandler } from "../muse-code"

const RUN = "01a20dd2-28ee-76b3-812a-68243200ab07"
const envelope = (payloadType: string, payload: Record<string, unknown>) => ({
	payload_type: payloadType,
	payload: { run_stream: { kind: "run", id: RUN }, ...payload },
})
const started = envelope("run.lifecycle.started", {})
const delta = (text: string) => envelope("run.output.delta", { text })
const usage = envelope("run.usage", {
	models: [
		{ model: "muse-spark-1.3", input_tokens: 1200, cached_tokens: 200, output_tokens: 50, reasoning_tokens: 10 },
	],
})
const terminal = (state: string, reason: string | null = null) =>
	envelope(`run.terminal.${state}`, { terminal: state, text: "", reason })

const tools: OpenAI.Chat.ChatCompletionTool[] = [
	{
		type: "function",
		function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: {} } },
	},
]
const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Read a.ts" }]

describe.skipIf(process.platform === "win32")("MuseCodeHandler", () => {
	let cli: FakeCli

	beforeEach(async () => {
		cli = await createFakeCli()
	})

	afterEach(async () => {
		await cli.dispose()
	})

	const handler = (options: Partial<ConstructorParameters<typeof MuseCodeHandler>[0]> = {}) =>
		new MuseCodeHandler({ museCodeExecutablePath: cli.executable, ...options })

	it("turns streamed text into text and tool call chunks and reports usage", async () => {
		await cli.script({
			lines: [
				started,
				delta("Reading it.\n<zoo_tool"),
				delta('_call>\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n</zoo_tool_call>'),
				usage,
				terminal("completed"),
			],
		})

		const chunks = await collectStream(handler().createMessage("SYSTEM", messages, { taskId: "t1", tools }))

		expect(chunks).toEqual([
			{ type: "text", text: "Reading it.\n" },
			{
				type: "tool_call",
				id: expect.stringMatching(/^call_[0-9a-f]{32}$/),
				name: "read_file",
				arguments: '{"path":"a.ts"}',
			},
			{
				type: "usage",
				inputTokens: 1200,
				outputTokens: 50,
				cacheReadTokens: 200,
				reasoningTokens: 10,
				totalCost: 0,
			},
		])
	})

	it("runs muse exec with the restriction flags, the model, the effort, and a private prompt file", async () => {
		await cli.script({ lines: [started, delta("hi"), terminal("completed")] })

		await collectStream(
			handler({ apiModelId: "muse-wonder-1.0" }).createMessage("SYSTEM PROMPT", messages, {
				taskId: "t1",
				tools,
			}),
		)
		const record = await cli.record()

		expect(record.argv.slice(0, 4)).toEqual(["exec", "--json", "--model", "muse-wonder-1.0"])
		expect(record.argv.join(" ")).toContain(MUSE_RESTRICTION_FLAGS.join(" "))
		expect(record.argv.slice(-2)).toEqual(["--reasoning-effort", "high"])
		expect(record.promptFile?.content).toContain("SYSTEM PROMPT")
		expect(record.promptFile?.content).toContain('"name":"read_file"')
		expect(existsSync(record.promptFile!.path)).toBe(false)
		expect(path.basename(record.cwd)).toBe("muse-code")
		expect(record.cwd.startsWith(realpathSync(os.tmpdir()))).toBe(true)
	})

	it("passes the selected reasoning effort", async () => {
		await cli.script({ lines: [started, terminal("completed")] })
		await collectStream(
			handler({ enableReasoningEffort: true, reasoningEffort: "low" }).createMessage("S", messages, {
				taskId: "t1",
			}),
		)
		expect((await cli.record()).argv.slice(-2)).toEqual(["--reasoning-effort", "low"])
	})

	it("keeps only the first tool call when parallel tool calls are off", async () => {
		const call = (file: string) =>
			`<zoo_tool_call>{"name":"read_file","arguments":{"path":"${file}"}}</zoo_tool_call>`
		await cli.script({ lines: [started, delta(`${call("a")}\n${call("b")}`), terminal("completed")] })

		const chunks = await collectStream(
			handler().createMessage("S", messages, { taskId: "t1", tools, parallelToolCalls: false }),
		)
		expect(chunks.filter((chunk) => chunk.type === "tool_call")).toHaveLength(1)
		expect(chunks.some((chunk) => chunk.type === "text")).toBe(false)
	})

	const stepCap = {
		lines: [started, usage, terminal("failed", "model did not reach a terminal state within 1 step(s)")],
		exitCode: 1,
	}

	it("retries once with a correction when the model called a built-in tool", async () => {
		await cli.script([
			stepCap,
			{
				lines: [
					started,
					delta('<zoo_tool_call>{"name":"read_file","arguments":{}}</zoo_tool_call>'),
					terminal("completed"),
				],
			},
		])

		const chunks = await collectStream(handler().createMessage("S", messages, { taskId: "t1", tools }))
		const records = await cli.records()

		expect(records).toHaveLength(2)
		expect(records[0].promptFile?.content).not.toContain("<zoo_host_correction>")
		expect(records[1].promptFile?.content).toContain("<zoo_host_correction>")
		expect(chunks.map((chunk) => chunk.type)).toEqual(["usage", "tool_call"])
	})

	it("ends quietly after the retry also reaches the step cap", async () => {
		await cli.script(stepCap)
		const chunks = await collectStream(handler().createMessage("S", messages, { taskId: "t1" }))
		expect(await cli.records()).toHaveLength(2)
		expect(chunks.map((chunk) => chunk.type)).toEqual(["usage", "usage"])
	})

	it("does not retry when the step-capped run already produced text", async () => {
		await cli.script({ ...stepCap, lines: [started, delta("Let me look."), ...stepCap.lines.slice(1)] })
		await collectStream(handler().createMessage("S", messages, { taskId: "t1" }))
		expect(await cli.records()).toHaveLength(1)
	})

	it("explains a failed run with a next step", async () => {
		await cli.script({ lines: [started, terminal("failed", "subscription limit reached")], exitCode: 1 })
		await expect(collectStream(handler().createMessage("S", messages, { taskId: "t1" }))).rejects.toThrow(
			/Muse Code: the run ended with status "failed": subscription limit reached[\s\S]*muse usage/,
		)
	})

	it.each([
		[
			"API error 429 [request_id=test]: Subscription quota exhausted. Your usage window resets at 2026-11-25T20:58:01Z. (rate_limit_error).",
			"ProviderQuotaExhaustedError",
		],
		["API error 429 [request_id=test]: Too many requests. (rate_limit_error).", "Error"],
	])("classifies the Muse failure %s", async (reason, name) => {
		await cli.script({ lines: [started, terminal("failed", reason)], exitCode: 1 })

		await expect(collectStream(handler().createMessage("S", messages))).rejects.toMatchObject({
			name,
			message: expect.stringContaining(reason),
		})
		expect(await cli.records()).toHaveLength(1)
	})

	it.each([true, false])("only releases deferred tools when the CLI turn succeeds (%s)", async (succeeds) => {
		await cli.script({
			lines: [
				started,
				delta("Reading it."),
				delta('<zoo_tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</zoo_tool_call>'),
				delta("Finishing the reply."),
				usage,
				succeeds ? terminal("completed") : terminal("failed", "Subscription quota exhausted"),
			],
			exitCode: succeeds ? 0 : 1,
		})
		const stream = handler({
			museCodeQuotaFallbackProfileId: "backup",
			museCodeQuotaFallbackAfterPartialReply: true,
		}).createMessage("S", messages, { taskId: "t1", tools })

		await expect(stream.next()).resolves.toMatchObject({ value: { type: "text", text: "Reading it." } })
		await expect(stream.next()).resolves.toMatchObject({ value: { type: "usage" } })
		if (succeeds) {
			await expect(collectStream(stream)).resolves.toEqual([
				{ type: "tool_call", id: expect.any(String), name: "read_file", arguments: '{"path":"a.ts"}' },
				{ type: "text", text: "Finishing the reply." },
			])
		} else {
			await expect(stream.next()).rejects.toMatchObject({ name: "ProviderQuotaExhaustedError" })
		}
	})

	it("explains an exit without a result and includes stderr", async () => {
		await cli.script({ lines: [], stderr: "error: not logged in", exitCode: 2 })
		await expect(collectStream(handler().createMessage("S", messages, { taskId: "t1" }))).rejects.toThrow(
			/exited \(code 2\) without a result[\s\S]*muse login[\s\S]*not logged in/,
		)
	})

	it("reports a missing executable", async () => {
		await expect(
			collectStream(
				handler({ museCodeExecutablePath: "/no/such/muse" }).createMessage("S", messages, { taskId: "t1" }),
			),
		).rejects.toThrow(/Muse Code executable not found/)
	})

	it("returns trimmed text from completePrompt", async () => {
		await cli.script({ lines: [started, delta("  improved prompt \n"), terminal("completed")] })
		await expect(handler().completePrompt("improve")).resolves.toBe("improved prompt")
		expect((await cli.record()).promptFile?.content).toContain("Do not call any tools")
	})
})

describe("MuseCodeHandler.getModel", () => {
	it("uses the default model when none is set", () => {
		const model = new MuseCodeHandler({}).getModel()
		expect(model.id).toBe(museCodeDefaultModelId)
		expect(model.info).toBe(museCodeModels[museCodeDefaultModelId])
	})

	it("keeps a custom model ID with default metadata", () => {
		const model = new MuseCodeHandler({ apiModelId: "muse-new-2.0" }).getModel()
		expect(model.id).toBe("muse-new-2.0")
		expect(model.info).toBe(museCodeDefaultModelInfo)
	})
})
