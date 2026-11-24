import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WorkerPoolOptions } from "workerpool"

import { countTokens, terminateCountTokensPool } from "../countTokens"

const { countOnHost } = vi.hoisted(() => ({ countOnHost: vi.fn(async () => 999) }))

let tempDir: string
let workerPath: string

vi.mock("../tiktoken", () => ({ tiktoken: countOnHost }))

vi.mock("workerpool", async (importOriginal) => {
	const actual = await importOriginal<typeof import("workerpool")>()
	return {
		default: {
			pool: (_script: string, options: WorkerPoolOptions) => actual.pool(workerPath, options),
		},
	}
})

beforeAll(async () => {
	const workerpoolPath = createRequire(import.meta.url).resolve("workerpool")
	tempDir = await mkdtemp(join(tmpdir(), "zoo-token-worker-"))
	workerPath = join(tempDir, "fixture.cjs")
	await writeFile(
		workerPath,
		`require(${JSON.stringify(workerpoolPath)}).worker({
			countTokens([{ text }]) {
				return text === "worker failure"
					? { success: false, error: "Fixture could not count tokens" }
					: { success: true, count: text.length }
			}
		})`,
	)
})

afterEach(async () => {
	await terminateCountTokensPool()
	countOnHost.mockClear()
	vi.restoreAllMocks()
})

afterAll(async () => {
	await rm(tempDir, { recursive: true, force: true })
})

it("keeps burst and subsequent counts on the worker", async () => {
	const texts = Array.from({ length: 24 }, (_, index) => "t".repeat(index + 1))

	expect(await Promise.all(texts.map((text) => countTokens([{ type: "text", text }])))).toEqual(
		texts.map((text) => text.length),
	)
	expect(await countTokens([{ type: "text", text: "after the burst" }])).toBe(15)
	expect(countOnHost).not.toHaveBeenCalled()
})

it("uses the local fallback when token counting on the worker fails", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {})
	const content = [{ type: "text", text: "worker failure" }] as const

	expect(await countTokens([...content])).toBe(999)
	expect(countOnHost).toHaveBeenCalledWith(content)
})
