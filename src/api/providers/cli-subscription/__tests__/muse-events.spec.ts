import { MuseEventReducer } from "../muse-events"

// Envelope shapes recorded from `muse exec --json` (Muse Code 1.4.25), trimmed to the fields used.
const ROOT = "01a20dd2-28ee-76b3-812a-68243200ab07"
const CHILD = "01a20dd2-ffff-7000-8000-000000000001"

const envelope = (payloadType: string, payload: Record<string, unknown>, runId = ROOT) => ({
	schema_version: 1,
	stream: { kind: "session", id: "01a20dd2-2626-7413-ae19-7b43615c9717" },
	payload_type: payloadType,
	payload: { command_id: runId, run_stream: { kind: "run", id: runId }, ...payload },
})

const started = envelope("run.lifecycle.started", { kind: "run_started", prompt: "..." })
const delta = (text: string, runId = ROOT) => envelope("run.output.delta", { kind: "run_output_delta", text }, runId)
const usage = envelope("run.usage", {
	kind: "run_usage",
	models: [
		{
			model: "muse-spark-1.3",
			input_tokens: 19656,
			cached_tokens: 1000,
			output_tokens: 496,
			reasoning_tokens: 435,
			calls: 1,
		},
		{
			model: "muse-spark-1.3",
			input_tokens: 10,
			cached_tokens: 0,
			output_tokens: 4,
			reasoning_tokens: 0,
			calls: 1,
		},
	],
	allowance: {
		tier: null,
		window: { used_percent: 0, resets_at_ms: 1795546207000 },
		weekly: { used_percent: 51, resets_at_ms: 1795996800000 },
	},
})
const terminal = (state: string, text: string, reason: string | null = null) =>
	envelope(`run.terminal.${state}`, { kind: "run_terminal", terminal: state, text, reason })

function run(events: unknown[]) {
	const reducer = new MuseEventReducer()
	const output = events.flatMap((event) => reducer.consume(event))
	return { reducer, output }
}

describe("MuseEventReducer", () => {
	it("streams deltas and reports a completed run", () => {
		const { reducer, output } = run([started, delta("PONG"), delta("\n"), terminal("completed", "PONG\n")])
		expect(output).toEqual([
			{ type: "text", text: "PONG" },
			{ type: "text", text: "\n" },
		])
		expect(reducer.succeeded).toBe(true)
	})

	it("sums usage across model calls and records the allowance", () => {
		const { reducer, output } = run([started, usage])
		expect(output).toEqual([
			{
				type: "usage",
				inputTokens: 19666,
				outputTokens: 500,
				cacheReadTokens: 1000,
				reasoningTokens: 435,
				totalCost: 0,
			},
		])
		expect(reducer.allowance?.weekly).toEqual({ usedPercent: 51, resetsAtMs: 1795996800000 })
	})

	it("uses the terminal text only when no delta arrived", () => {
		expect(run([started, terminal("completed", "final answer")]).output).toEqual([
			{ type: "text", text: "final answer" },
		])
		expect(run([started, delta("streamed"), terminal("completed", "streamed")]).output).toEqual([
			{ type: "text", text: "streamed" },
		])
	})

	it("ignores output from other runs and a repeated terminal event", () => {
		const { reducer, output } = run([
			started,
			delta("child text", CHILD),
			delta("root text"),
			terminal("completed", "root text"),
			terminal("failed", "", "late duplicate"),
			delta("after the end"),
		])
		expect(output).toEqual([{ type: "text", text: "root text" }])
		expect(reducer.terminal?.terminal).toBe("completed")
	})

	it("detects a run that stopped at the step cap after a built-in tool call", () => {
		const { reducer } = run([
			started,
			terminal("failed", "", "model did not reach a terminal state within 1 step(s)"),
		])
		expect(reducer.succeeded).toBe(false)
		expect(reducer.endedAtStepCap).toBe(true)
	})

	it("does not treat other failures as the step cap", () => {
		const { reducer } = run([started, terminal("failed", "", "subscription limit reached")])
		expect(reducer.endedAtStepCap).toBe(false)
	})

	it.each([[null], ["text"], [{ payload_type: "run.output.delta" }], [{ payload_type: 1, payload: {} }]])(
		"ignores malformed input %j",
		(value) => {
			expect(run([value]).output).toEqual([])
		},
	)
})
