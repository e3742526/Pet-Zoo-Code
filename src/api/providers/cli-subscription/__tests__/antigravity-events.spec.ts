import { AntigravityEventReducer, parseAntigravityStderrError } from "../antigravity-events"

// Event shapes recorded from `agy --output-format stream-json` (agy 1.5.16), trimmed.
const CONVERSATION = "add15bc7-f4fb-4e13-b630-6df548c9f507"

const init = {
	event: "init",
	conversation_id: CONVERSATION,
	init: { model: "gemini-3.8-flash-low", cwd: "/tmp", tools: ["read_file"], permission_mode: "request-review" },
}
const step = (fields: Record<string, unknown>) => ({
	event: "step_update",
	step_update: { conversation_id: CONVERSATION, ...fields },
})
const responseDelta = (text: string, state = "ACTIVE") =>
	step({ step_index: 1, state, step_type: "agent_response", text_delta: text })
const result = (status: string, response: string, extra: Record<string, unknown> = {}) => ({
	event: "result",
	result: {
		conversation_id: CONVERSATION,
		status,
		response,
		num_turns: 1,
		usage: {
			input_tokens: 2617,
			output_tokens: 102,
			thinking_tokens: 7,
			cache_read_tokens: 20444,
			total_tokens: 2719,
		},
		...extra,
	},
})

function run(events: unknown[]) {
	const reducer = new AntigravityEventReducer()
	const output = events.flatMap((event) => reducer.consume(event))
	return { reducer, output }
}

describe("AntigravityEventReducer", () => {
	it("streams agent response text and adds cached tokens to the input total once", () => {
		const { reducer, output } = run([
			init,
			step({ step_index: 0, state: "DONE", step_type: "user_input" }),
			responseDelta("PONG"),
			step({
				step_index: 1,
				state: "DONE",
				step_type: "agent_response",
				text_delta: ".\n",
				usage: { input_tokens: 2617, output_tokens: 102, cache_read_tokens: 20444 },
			}),
			result("SUCCESS", "PONG.\n"),
		])

		expect(output).toEqual([
			{ type: "text", text: "PONG" },
			{ type: "text", text: ".\n" },
			{
				type: "usage",
				inputTokens: 2617 + 20444,
				outputTokens: 102,
				cacheReadTokens: 20444,
				reasoningTokens: 7,
				totalCost: 0,
			},
		])
		expect(reducer.succeeded).toBe(true)
		expect(reducer.conversationId).toBe(CONVERSATION)
	})

	it("uses the result response when no text was streamed", () => {
		expect(run([init, result("SUCCESS", "only in result")]).output[0]).toEqual({
			type: "text",
			text: "only in result",
		})
	})

	it("records built-in tool runs without showing them as text", () => {
		const { reducer, output } = run([
			step({ step_index: 2, state: "ACTIVE", step_type: "tool", tool_name: "write_file" }),
			step({ step_index: 2, state: "DONE", step_type: "tool", tool_name: "write_file" }),
		])
		expect(output).toEqual([])
		expect(reducer.builtInToolsUsed).toEqual(["write_file"])
	})

	it("emits thinking deltas as reasoning", () => {
		expect(run([step({ step_type: "agent_response", thinking_delta: "hmm" })]).output).toEqual([
			{ type: "reasoning", text: "hmm" },
		])
	})

	it("reports a failed turn and keeps its error", () => {
		const { reducer, output } = run([init, result("FAILURE", "", { error: { message: "quota exceeded" } })])
		expect(reducer.succeeded).toBe(false)
		expect(reducer.result?.error).toContain("quota exceeded")
		expect(output.some((event) => event.type === "text")).toBe(false)
	})

	it("ignores events after the result", () => {
		expect(run([result("SUCCESS", "a"), responseDelta("late"), result("SUCCESS", "b")]).output).toHaveLength(2)
	})
})

describe("parseAntigravityStderrError", () => {
	it("extracts the short error", () => {
		const stderr = 'error: something\nAGY_ERROR: {"short_error":"print timeout after 1s","details":"x"}\n'
		expect(parseAntigravityStderrError(stderr)).toBe("print timeout after 1s")
	})

	it.each([[""], ["AGY_ERROR: not json"], ["plain failure"]])("returns undefined for %j", (stderr) => {
		expect(parseAntigravityStderrError(stderr)).toBeUndefined()
	})
})
