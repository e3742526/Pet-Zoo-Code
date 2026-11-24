import { mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ClineMessage } from "@roo-code/types"

import { setPersistenceTraceSink } from "../persistenceTrace"
import { readTaskMessages, saveTaskMessages } from "../taskMessages"

describe("UI transcript replacement", () => {
	const taskId = "task"
	const first: ClineMessage = { ts: 1, messageId: "first", type: "say", say: "text", text: "Original" }
	const peer: ClineMessage = { ts: 2, messageId: "peer", type: "say", say: "text", text: "Written by another host" }
	let globalStoragePath: string
	let trace: string[]

	const save = (messages: ClineMessage[], merge = true) =>
		saveTaskMessages({ taskId, globalStoragePath, messages, merge })
	const read = () => readTaskMessages({ taskId, globalStoragePath })
	const replacements = () => trace.filter((line) => line.includes('"stage":"ui-messages-write-complete"'))

	beforeEach(async () => {
		globalStoragePath = await mkdtemp(join(tmpdir(), "zoo-ui-messages-"))
		trace = []
		setPersistenceTraceSink((line) => trace.push(line))
	})

	afterEach(async () => {
		setPersistenceTraceSink(undefined)
		await rm(globalStoragePath, { recursive: true, force: true })
	})

	it("skips an unchanged merge against a peer's committed update", async () => {
		await save([{ ...first }])
		await save([{ ...first }, { ...peer }])
		trace.length = 0

		const saved = await save([{ ...first, images: undefined }])

		expect(saved).toMatchObject([first, peer])
		expect(await read()).toEqual([first, peer])
		expect(replacements()).toHaveLength(0)

		const updated = { ...peer, text: "Later update" }
		await save([{ ...first }, updated])
		expect(await read()).toEqual([first, updated])
		expect(replacements()).toHaveLength(1)
	})

	it("replaces the file when an undefined field clears a persisted value", async () => {
		await save([{ ...first, images: ["data:image/png;base64,AA=="] }])
		trace.length = 0

		await save([{ ...first, images: undefined }])
		expect(await read()).toEqual([first])
		expect(replacements()).toHaveLength(1)

		await save([{ ...first, images: undefined }])
		expect(replacements()).toHaveLength(1)
	})

	it("recovers the committed backup before checking whether replacement is needed", async () => {
		await save([{ ...first }])
		const dir = join(globalStoragePath, "tasks", taskId)
		await rename(join(dir, "ui_messages.json"), join(dir, ".ui_messages.json.bak_100_test.tmp"))
		await writeFile(join(dir, ".ui_messages.json.new_100_test.tmp"), "uncommitted")
		trace.length = 0

		await save([{ ...first }])

		expect(await read()).toEqual([first])
		expect(trace.some((line) => line.includes('"stage":"ui-messages-recovery"'))).toBe(true)
		expect(replacements()).toHaveLength(0)
	})

	it("publishes an empty file on initial merge and still supports explicit replacement", async () => {
		await save([])
		expect(await read()).toEqual([])
		expect(replacements()).toHaveLength(1)

		await save([], false)
		expect(replacements()).toHaveLength(2)
	})

	it("replaces corrupt JSON on a merged save", async () => {
		await save([{ ...first }])
		await writeFile(join(globalStoragePath, "tasks", taskId, "ui_messages.json"), "[{")
		trace.length = 0

		await save([{ ...first }])

		expect(await read()).toEqual([first])
		expect(replacements()).toHaveLength(1)
	})
})
