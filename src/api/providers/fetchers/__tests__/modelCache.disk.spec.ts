import { existsSync, readFileSync } from "fs"
import { readFile } from "fs/promises"

import { providerIdentifiers, type ModelRecord } from "@roo-code/types"

import type { ApiHandler } from "../../../index"
import { flushModels, getModels, getModelsFromCache, refreshModels } from "../modelCache"

vi.mock("../../../../core/config/ContextProxy", () => ({
	ContextProxy: { instance: { globalStorageUri: { fsPath: "/test-storage" } } },
}))

vi.mock("../../../../utils/storage", () => ({ getCacheDirectoryPath: vi.fn(async () => "/test-storage/cache") }))
vi.mock("../../../../utils/safeWriteJson", () => ({ safeWriteJson: vi.fn(async () => undefined) }))
vi.mock("@roo-code/telemetry", () => ({ TelemetryService: { instance: { captureEvent: vi.fn() } } }))

vi.mock("fs", async (importOriginal) => ({
	...(await importOriginal<typeof import("fs")>()),
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}))

vi.mock("fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("fs/promises")>()),
	readFile: vi.fn(),
}))

const options = { provider: providerIdentifiers.openrouter } as const
const diskModels: ModelRecord = {
	"cached-model": { maxTokens: 4096, contextWindow: 32768, supportsPromptCache: false },
}
const freshModels: ModelRecord = {
	"fresh-model": { maxTokens: 8192, contextWindow: 65536, supportsPromptCache: true },
}

const fetchModels = vi.fn<NonNullable<ApiHandler["fetchModels"]>>()
const handler: ApiHandler = {
	fetchModels,
	getModelCacheScope: () => ({ authScoped: false, urlScoped: false, keyScoped: false }),
	getModel: vi.fn<ApiHandler["getModel"]>(),
	countTokens: vi.fn<ApiHandler["countTokens"]>(),
	createMessage: vi.fn<ApiHandler["createMessage"]>(),
}

const readFromDisk = vi.mocked(readFile)

function holdDiskRead() {
	let finish!: (value: string) => void
	readFromDisk.mockReturnValueOnce(new Promise<string>((resolve) => (finish = resolve)))
	return finish
}

beforeEach(async () => {
	await flushModels(options, handler)
	fetchModels.mockReset().mockResolvedValue(freshModels)
	readFromDisk.mockReset().mockResolvedValue(JSON.stringify(diskModels))
	vi.mocked(existsSync).mockReset().mockReturnValue(false)
	vi.mocked(readFileSync).mockReset()
})

it("shares an asynchronous cold read and returns a separate catalog to each caller", async () => {
	const finish = holdDiskRead()
	const first = getModels(options, handler)
	const second = getModels(options, handler)
	expect(readFromDisk).toHaveBeenCalledTimes(1)
	expect(existsSync).not.toHaveBeenCalled()
	expect(readFileSync).not.toHaveBeenCalled()

	finish(JSON.stringify(diskModels))
	const [left, right] = await Promise.all([first, second])
	expect(left).toEqual(diskModels)
	expect(right).toEqual(diskModels)
	expect(right["cached-model"]).not.toBe(left["cached-model"])
	expect(getModelsFromCache(options, handler)).toEqual(diskModels)
	expect(readFileSync).not.toHaveBeenCalled()
	expect(fetchModels).not.toHaveBeenCalled()
})

it("still loads a cold catalog for synchronous model metadata callers", () => {
	vi.mocked(existsSync).mockReturnValue(true)
	vi.mocked(readFileSync).mockReturnValue(JSON.stringify(diskModels))

	expect(getModelsFromCache(options, handler)).toEqual(diskModels)
	expect(readFileSync).toHaveBeenCalledTimes(1)
	expect(readFromDisk).not.toHaveBeenCalled()
})

it("reuses a disk miss until the catalog is flushed", async () => {
	readFromDisk.mockRejectedValueOnce(Object.assign(new Error("Missing fixture cache"), { code: "ENOENT" }))
	fetchModels.mockResolvedValue({})

	await expect(getModels(options, handler)).resolves.toEqual({})
	await expect(getModels(options, handler)).resolves.toEqual({})
	expect(readFromDisk).toHaveBeenCalledTimes(1)

	await flushModels(options, handler)
	await expect(getModels(options, handler)).resolves.toEqual(diskModels)
	expect(readFromDisk).toHaveBeenCalledTimes(2)
})

it("keeps data from a provider refresh when an older disk read finishes afterward", async () => {
	const finish = holdDiskRead()
	const loading = getModels(options, handler)

	await expect(refreshModels(options, handler)).resolves.toEqual(freshModels)
	expect(readFromDisk).toHaveBeenCalledTimes(1)

	finish(JSON.stringify(diskModels))
	await expect(loading).resolves.toEqual(freshModels)
	expect(getModelsFromCache(options, handler)).toEqual(freshModels)
	expect(fetchModels).toHaveBeenCalledTimes(1)
})

it("leaves the disk read available to other callers when a caller aborts", async () => {
	const finish = holdDiskRead()
	const controller = new AbortController()
	const aborted = getModels({ ...options, signal: controller.signal }, handler)
	const loading = getModels(options, handler)

	controller.abort()
	await expect(aborted).rejects.toMatchObject({ name: "AbortError" })
	finish(JSON.stringify(diskModels))
	await expect(loading).resolves.toEqual(diskModels)
	expect(readFromDisk).toHaveBeenCalledTimes(1)
	expect(fetchModels).not.toHaveBeenCalled()
})

it("skips a cold read for a caller that has already aborted", async () => {
	await expect(getModels({ ...options, signal: AbortSignal.abort() }, handler)).rejects.toMatchObject({
		name: "AbortError",
	})
	expect(readFromDisk).not.toHaveBeenCalled()
	expect(fetchModels).not.toHaveBeenCalled()
})

it("prevents a disk read from repopulating the cache after a flush", async () => {
	const finish = holdDiskRead()
	const controller = new AbortController()
	const loading = getModels({ ...options, signal: controller.signal }, handler)
	await flushModels(options, handler)
	controller.abort()
	await expect(loading).rejects.toMatchObject({ name: "AbortError" })
	finish(JSON.stringify(diskModels))
	await new Promise<void>((resolve) => setImmediate(resolve))

	expect(getModelsFromCache(options, handler)).toBeUndefined()
	expect(fetchModels).not.toHaveBeenCalled()
})

it.each(["empty", "failed"])("returns the last disk catalog when a refresh is %s", async (result) => {
	if (result === "empty") fetchModels.mockResolvedValue({})
	else fetchModels.mockRejectedValue(new Error("Provider unavailable"))

	await expect(refreshModels(options, handler)).resolves.toEqual(diskModels)
	expect(readFromDisk).toHaveBeenCalledTimes(1)
	expect(readFileSync).not.toHaveBeenCalled()
})

it.each(["not JSON", '{"bad":{"contextWindow":"invalid"}}'])(
	"fetches models when the disk catalog is invalid: %s",
	async (payload) => {
		readFromDisk.mockResolvedValueOnce(payload)

		await expect(getModels(options, handler)).resolves.toEqual(freshModels)
		expect(fetchModels).toHaveBeenCalledTimes(1)
	},
)
