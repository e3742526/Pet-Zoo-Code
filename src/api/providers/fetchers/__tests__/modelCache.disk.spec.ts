import { existsSync, readFileSync } from "fs"
import { readFile } from "fs/promises"

import { providerIdentifiers, type ModelRecord } from "@roo-code/types"

import type { ApiHandler } from "../../../index"
import { getCustomStoragePath } from "../../../../utils/storage"
import { flushModels, getModelFromCache, getModels, refreshModels } from "../modelCache"

vi.mock("../../../../core/config/ContextProxy", () => ({
	ContextProxy: { instance: { globalStorageUri: { fsPath: "/test-storage" } } },
}))

vi.mock("../../../../utils/storage", () => ({
	getCacheDirectoryPath: vi.fn(async () => "/test-storage/cache"),
	getCustomStoragePath: vi.fn(),
}))
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
	vi.mocked(getCustomStoragePath).mockReset().mockReturnValue("")
})

it("shares an asynchronous cold read and returns a separate catalog to each caller", async () => {
	const finish = holdDiskRead()
	const first = getModels(options, handler)
	const second = getModels(options, handler)
	const selected = getModels(options, handler, "cached-model")
	expect(readFromDisk).toHaveBeenCalledTimes(1)
	expect(existsSync).not.toHaveBeenCalled()
	expect(readFileSync).not.toHaveBeenCalled()

	finish(JSON.stringify(diskModels))
	const [left, right, single] = await Promise.all([first, second, selected])
	expect(left).toEqual(diskModels)
	expect(right).toEqual(diskModels)
	expect(single).toEqual(diskModels)
	expect(right["cached-model"]).not.toBe(left["cached-model"])
	expect(single["cached-model"]).not.toBe(left["cached-model"])
	expect(single["cached-model"]).not.toBe(right["cached-model"])
	expect(getModelFromCache(options, handler, "cached-model")).toEqual(diskModels["cached-model"])
	expect(readFileSync).not.toHaveBeenCalled()
	expect(fetchModels).not.toHaveBeenCalled()
})

it.each([
	["lookup", getModels],
	["refresh", refreshModels],
] as const)("stores the complete provider response for a selected model %s", async (_operation, load) => {
	const complete = { ...freshModels, ...diskModels }
	readFromDisk.mockRejectedValue(Object.assign(new Error("Missing fixture cache"), { code: "ENOENT" }))
	fetchModels.mockResolvedValueOnce(complete)

	const selected = await load(options, handler, "fresh-model")
	expect(selected).toEqual(freshModels)
	expect(selected["fresh-model"]).not.toBe(complete["fresh-model"])
	selected["fresh-model"].maxTokens = 12
	expect(await getModels(options, handler)).toEqual(complete)
	expect(await getModels(options, handler, "absent-model")).toEqual({})
	expect(fetchModels).toHaveBeenCalledTimes(1)
})

it.each(["empty catalog", "fetch error"] as const)(
	"copies one entry from a retained catalog after a refresh returns %s",
	async (result) => {
		const previous = { ...diskModels, ...freshModels }
		readFromDisk.mockResolvedValueOnce(JSON.stringify(previous))
		if (result === "empty catalog") {
			fetchModels.mockResolvedValueOnce({})
		} else {
			fetchModels.mockRejectedValueOnce(new Error("Provider offline"))
		}

		const clone = vi.spyOn(globalThis, "structuredClone")
		try {
			const selected = await refreshModels(options, handler, "cached-model")
			expect(selected).toEqual(diskModels)
			expect(clone.mock.calls).toEqual([[diskModels["cached-model"]]])
			selected["cached-model"].maxTokens = 12
		} finally {
			clone.mockRestore()
		}
		for (const [id, model] of Object.entries(previous)) {
			expect(getModelFromCache(options, handler, id)).toEqual(model)
		}
		expect(readFromDisk).toHaveBeenCalledTimes(1)
	},
)

it("still loads a cold catalog for synchronous model metadata callers", () => {
	vi.mocked(existsSync).mockReturnValue(true)
	vi.mocked(readFileSync).mockReturnValue(JSON.stringify(diskModels))

	expect(getModelFromCache(options, handler, "cached-model")).toEqual(diskModels["cached-model"])
	expect(readFileSync).toHaveBeenCalledTimes(1)
	expect(readFromDisk).not.toHaveBeenCalled()
})

it("uses a different disk read after the configured location changes", async () => {
	const finishPrevious = holdDiskRead()
	const previous = getModels(options, handler)
	vi.mocked(getCustomStoragePath).mockReturnValue("/new-storage")
	const finishCurrent = holdDiskRead()
	const current = getModels(options, handler)

	finishPrevious(JSON.stringify(diskModels))
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(fetchModels).not.toHaveBeenCalled()
	finishCurrent(JSON.stringify(freshModels))
	await expect(current).resolves.toEqual(freshModels)
	await expect(previous).resolves.toEqual(freshModels)
	expect(readFromDisk).toHaveBeenCalledTimes(2)
	expect(fetchModels).not.toHaveBeenCalled()
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
	expect(getModelFromCache(options, handler, "fresh-model")).toEqual(freshModels["fresh-model"])
	expect(getModelFromCache(options, handler, "cached-model")).toBeUndefined()
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

	expect(getModelFromCache(options, handler, "cached-model")).toBeUndefined()
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

it("reads a selected model offline and isolates copies of nested metadata", async () => {
	const modelId = "cached-model"
	const models: ModelRecord = {
		[modelId]: { ...diskModels[modelId], includedTools: ["read_file"] },
	}
	vi.mocked(existsSync).mockReturnValue(true)
	vi.mocked(readFileSync).mockReturnValue(JSON.stringify(models))

	const selected = getModelFromCache(options, handler, modelId)
	expect(selected).toEqual(models[modelId])
	selected?.includedTools?.push("write_to_file")

	const asyncCatalog = await getModels(options, handler)
	expect(asyncCatalog).toEqual(models)
	asyncCatalog[modelId].includedTools?.push("apply_diff")

	expect(getModelFromCache(options, handler, modelId)).toEqual(models[modelId])
	expect(getModelFromCache(options, handler, "constructor")).toBeUndefined()
	expect(readFileSync).toHaveBeenCalledTimes(1)
	expect(readFromDisk).not.toHaveBeenCalled()
	expect(fetchModels).not.toHaveBeenCalled()
})

it("stores its own copy of the catalog returned by a provider", async () => {
	const modelId = "fresh-model"
	const catalog: ModelRecord = {
		[modelId]: { ...freshModels[modelId], includedTools: ["read_file"] },
	}
	fetchModels.mockResolvedValueOnce(catalog)

	const result = await refreshModels(options, handler)
	expect(result).toEqual(catalog)
	result[modelId].includedTools?.push("list_files")

	expect(getModelFromCache(options, handler, modelId)?.includedTools).toEqual(["read_file"])
	expect(readFileSync).not.toHaveBeenCalled()
})

it("skips cached metadata for providers with auth-scoped catalogs", async () => {
	await getModels(options, handler)

	const authHandler: ApiHandler = {
		...handler,
		getModelCacheScope: () => ({ authScoped: true, urlScoped: false, keyScoped: false }),
	}
	expect(getModelFromCache(options, authHandler, "cached-model")).toBeUndefined()
	expect(readFileSync).not.toHaveBeenCalled()
	expect(fetchModels).not.toHaveBeenCalled()
})
