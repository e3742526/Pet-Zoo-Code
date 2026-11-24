import {
	findJsonObjectEnd,
	normalizeToolCallPayload,
	ToolCallStreamParser,
	type ToolCallProtocolEvent,
} from "../tool-call-protocol"

/** Feeds `text` in chunks of `size` characters and merges adjacent text events. */
function parse(text: string, size = text.length): ToolCallProtocolEvent[] {
	const parser = new ToolCallStreamParser()
	const events: ToolCallProtocolEvent[] = []
	for (let index = 0; index < text.length; index += size) {
		events.push(...parser.push(text.slice(index, index + size)))
	}
	events.push(...parser.finish())

	const merged: ToolCallProtocolEvent[] = []
	for (const event of events) {
		const last = merged[merged.length - 1]
		if (event.type === "text" && last?.type === "text") {
			last.text += event.text
		} else {
			merged.push({ ...event })
		}
	}
	return merged
}

const readCall = '<zoo_tool_call>\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n</zoo_tool_call>'

describe("findJsonObjectEnd", () => {
	it("ignores braces and quotes inside strings", () => {
		const source = '{"a": "} \\" {", "b": {"c": 1}} tail'
		expect(source.slice(0, findJsonObjectEnd(source, 0))).toBe('{"a": "} \\" {", "b": {"c": 1}}')
	})

	it("returns -1 for an incomplete object", () => {
		expect(findJsonObjectEnd('{"a": {"b": 1}', 0)).toBe(-1)
	})
})

describe("normalizeToolCallPayload", () => {
	it.each([
		[{ name: "read_file", arguments: { path: "a" } }],
		[{ name: "read_file", input: { path: "a" } }],
		[{ tool: "read_file", parameters: { path: "a" } }],
		[{ name: "read_file", arguments: '{"path": "a"}' }],
	])("accepts %j", (payload) => {
		expect(normalizeToolCallPayload(payload)).toEqual({ name: "read_file", arguments: '{"path":"a"}' })
	})

	it("defaults missing arguments to an empty object", () => {
		expect(normalizeToolCallPayload({ name: "list" })).toEqual({ name: "list", arguments: "{}" })
	})

	it.each([
		[null],
		[[]],
		[{ arguments: {} }],
		[{ name: "" }],
		[{ name: "x", arguments: "not json" }],
		[{ name: "x", arguments: [1] }],
	])("rejects %j", (payload) => {
		expect(normalizeToolCallPayload(payload)).toBeUndefined()
	})
})

describe("ToolCallStreamParser", () => {
	it("passes plain text through", () => {
		expect(parse("Hello <world> and < zoo")).toEqual([{ type: "text", text: "Hello <world> and < zoo" }])
	})

	it.each([1, 2, 3, 7, 1000])("extracts a tool call when streamed in chunks of %i characters", (size) => {
		expect(parse(`I will read it.\n\n${readCall}`, size)).toEqual([
			{ type: "text", text: "I will read it.\n\n" },
			{ type: "tool_call", name: "read_file", arguments: '{"path":"a.ts"}' },
		])
	})

	it("extracts several tool calls and the text between them", () => {
		expect(parse(`${readCall}\nthen\n${readCall.replace("a.ts", "b.ts")}`, 5)).toEqual([
			{ type: "tool_call", name: "read_file", arguments: '{"path":"a.ts"}' },
			{ type: "text", text: "\nthen\n" },
			{ type: "tool_call", name: "read_file", arguments: '{"path":"b.ts"}' },
		])
	})

	it("keeps protocol tags and braces that appear inside argument strings", () => {
		const content = 'const x = "<zoo_tool_call>{</zoo_tool_call>}"'
		const call = `<zoo_tool_call>${JSON.stringify({ name: "write_to_file", arguments: { path: "x.ts", content } })}</zoo_tool_call>`
		expect(parse(call, 4)).toEqual([
			{ type: "tool_call", name: "write_to_file", arguments: JSON.stringify({ path: "x.ts", content }) },
		])
	})

	it.each([1, 2, 3, 4, 1000])("accepts a code fence around the JSON in chunks of %i characters", (size) => {
		expect(
			parse('<zoo_tool_call>\n```json\n{"name":"a","arguments":{}}\n```\n</zoo_tool_call>\nafter', size),
		).toEqual([
			{ type: "tool_call", name: "a", arguments: "{}" },
			{ type: "text", text: "\nafter" },
		])
	})

	it("accepts a call without a close tag at the end of the stream", () => {
		expect(parse('<zoo_tool_call>{"name":"a","arguments":{"x":1}}')).toEqual([
			{ type: "tool_call", name: "a", arguments: '{"x":1}' },
		])
	})

	it.each([
		["text instead of JSON", "<zoo_tool_call>read_file a.ts</zoo_tool_call>"],
		["invalid JSON", '<zoo_tool_call>{"name": read_file}</zoo_tool_call>'],
		["JSON without a name", '<zoo_tool_call>{"arguments": {}}</zoo_tool_call>'],
		["an unfinished object", '<zoo_tool_call>{"name": "a", "arguments": {'],
	])("returns %s as text", (_label, text) => {
		expect(parse(text, 2)).toEqual([{ type: "text", text }])
	})

	it("releases a held partial tag when the stream ends", () => {
		const parser = new ToolCallStreamParser()
		expect(parser.push("done <zoo_tool")).toEqual([{ type: "text", text: "done " }])
		expect(parser.finish()).toEqual([{ type: "text", text: "<zoo_tool" }])
	})
})
