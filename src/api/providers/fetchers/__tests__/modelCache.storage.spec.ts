import { mkdtemp, readdir, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import * as vscode from "vscode"

import { providerIdentifiers, type ModelRecord } from "@roo-code/types"

import { makeWorkspaceConfiguration } from "../../../../test-utils/vscode"
import type { ApiHandler } from "../../../index"
import { flushModels, getModels, getModelsFromCache, refreshModels } from "../modelCache"
import { getOpenRouterModelEndpoints } from "../openrouter"

const storage = vi.hoisted(() => ({ global: "" }))
vi.mock("../../../../core/config/ContextProxy", () => ({
	ContextProxy: {
		instance: {
			get globalStorageUri() {
				return { fsPath: storage.global }
			},
		},
	},
}))
vi.mock("../openrouter", () => ({ getOpenRouterModelEndpoints: vi.fn() }))

const options = { provider: providerIdentifiers.openrouter } as const
const catalog: ModelRecord = {
	"vendor/model": { maxTokens: 4096, contextWindow: 32768, supportsPromptCache: false },
}
const endpoints: ModelRecord = {
	"test-endpoint": { maxTokens: 2048, contextWindow: 16384, supportsPromptCache: false },
}
const fetchModels = vi.fn<NonNullable<ApiHandler["fetchModels"]>>()
const handler: ApiHandler = {
	fetchModels,
	getModel: vi.fn<ApiHandler["getModel"]>(),
	countTokens: vi.fn<ApiHandler["countTokens"]>(),
	createMessage: vi.fn<ApiHandler["createMessage"]>(),
	getModelCacheScope: () => ({ urlScoped: false, keyScoped: false, authScoped: false }),
}

let root: string
let customStoragePath: string

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "model-cache-storage-"))
	storage.global = join(root, "global")
	customStoragePath = join(root, "custom")
	vi.spyOn(vscode.workspace, "getConfiguration").mockImplementation(() =>
		makeWorkspaceConfiguration({ customStoragePath }),
	)
	fetchModels.mockReset().mockResolvedValue(catalog)
	await flushModels(options, handler)
})

afterEach(async () => {
	await flushModels(options, handler)
	vi.restoreAllMocks()
	await rm(root, { recursive: true, force: true })
})

it.each(["catalog request", "synchronous model metadata"] as const)(
	"reopens the custom storage catalog for a cold %s while offline",
	async (caller) => {
		await expect(refreshModels(options, handler)).resolves.toEqual(catalog)
		expect(await readdir(join(customStoragePath, "cache"))).toEqual([expect.stringMatching(/_models\.json$/)])
		await flushModels(options, handler)
		fetchModels.mockClear().mockRejectedValue(new Error("Provider offline"))

		const result =
			caller === "catalog request" ? await getModels(options, handler) : getModelsFromCache(options, handler)
		expect(result).toEqual(catalog)
		expect(fetchModels).not.toHaveBeenCalled()
	},
)

it("keeps a catalog in default storage available after a custom path is set", async () => {
	const destination = customStoragePath
	customStoragePath = ""
	await refreshModels(options, handler)
	await flushModels(options, handler)
	customStoragePath = destination
	fetchModels.mockClear().mockRejectedValue(new Error("Provider offline"))

	await expect(getModels(options, handler)).resolves.toEqual(catalog)
	await flushModels(options, handler)
	expect(getModelsFromCache(options, handler)).toEqual(catalog)
	expect(fetchModels).not.toHaveBeenCalled()
})

it("does not reuse a default storage miss after switching to a custom path", async () => {
	await refreshModels(options, handler)
	await flushModels(options, handler)
	const destination = customStoragePath
	customStoragePath = ""
	expect(getModelsFromCache(options, handler)).toBeUndefined()
	customStoragePath = destination
	fetchModels.mockClear().mockRejectedValue(new Error("Provider offline"))

	await expect(getModels(options, handler)).resolves.toEqual(catalog)
	expect(fetchModels).not.toHaveBeenCalled()
})

it("reopens the saved endpoint list for the requested model when its live list is empty", async () => {
	const { getModelEndpoints } = await import("../modelEndpointCache")
	const endpointOptions = {
		router: providerIdentifiers.openrouter,
		modelId: "vendor/model",
		endpoint: "test-endpoint",
	}
	vi.mocked(getOpenRouterModelEndpoints).mockResolvedValueOnce(endpoints)
	await expect(getModelEndpoints(endpointOptions, handler)).resolves.toEqual(endpoints)
	expect(await readdir(join(customStoragePath, "cache"))).toContain("openrouter_vendormodel_endpoints.json")

	vi.useFakeTimers({ toFake: ["Date"] })
	try {
		vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1)
		vi.mocked(getOpenRouterModelEndpoints).mockResolvedValueOnce({})
		await expect(getModelEndpoints(endpointOptions, handler)).resolves.toEqual(endpoints)
	} finally {
		vi.useRealTimers()
	}
})
