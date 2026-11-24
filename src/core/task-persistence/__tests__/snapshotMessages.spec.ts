import { snapshotMessages } from "../snapshotMessages"

describe("snapshotMessages", () => {
	it("copies plain message data without invoking structuredClone", () => {
		const legacy = { ["__proto__"]: { note: "saved" }, constructor: "legacy record" }
		const images = ["data:image/png;base64,AA=="]
		const shared = { text: "tool output", images, legacy }
		const nativeClone = vi.spyOn(globalThis, "structuredClone")

		try {
			const [snapshot] = snapshotMessages([{ first: shared, second: shared }])
			expect(nativeClone).not.toHaveBeenCalled()
			expect(snapshot.first).not.toBe(shared)
			expect(snapshot.first).toBe(snapshot.second)
			expect(snapshot.first.images).not.toBe(images)
			expect(snapshot.first.legacy).not.toBe(legacy)
			expect(snapshot.first.legacy).toEqual(legacy)
			expect(Object.getPrototypeOf(snapshot.first.legacy)).toBe(Object.prototype)
			expect(Object.hasOwn(snapshot.first.legacy, "__proto__")).toBe(true)
		} finally {
			nativeClone.mockRestore()
		}
	})

	it("preserves sparse arrays and undefined fields", () => {
		const content = new Array<string | undefined>(3)
		content[1] = undefined
		content[2] = "text"
		const messages = [{ content, partial: undefined }]

		expect(snapshotMessages(messages)).toStrictEqual(structuredClone(messages))
	})

	it("uses the native clone for accessors and non-plain values", () => {
		const readText = vi.fn(() => "tool output")
		const source = new Map([["value", { tokens: 12 }]])
		const [snapshot] = snapshotMessages([
			{
				get text() {
					return readText()
				},
				source,
			},
		])
		source.get("value")!.tokens = 99

		expect(readText).toHaveBeenCalledTimes(1)
		expect(snapshot.text).toBe("tool output")
		expect(snapshot.source.get("value")).toEqual({ tokens: 12 })
	})

	it("preserves native cloning failures for unsupported values", () => {
		expect(() => snapshotMessages([{ value: Symbol("unsupported") }])).toThrow(
			expect.objectContaining({ name: "DataCloneError" }),
		)
	})
})
