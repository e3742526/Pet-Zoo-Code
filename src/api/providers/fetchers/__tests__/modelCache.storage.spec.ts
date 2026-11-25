import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import * as vscode from "vscode"

import { providerIdentifiers, type ModelInfo, type ModelRecord } from "@roo-code/types"

import { makeWorkspaceConfiguration } from "../../../../test-utils/vscode"
import type { ApiHandler } from "../../../index"
import { LiteLLMHandler } from "../../lite-llm"
import { OpenRouterHandler } from "../../openrouter"
import { flushModels, getCatalogModel, getModels, getModelsFromCache, refreshModels } from "../modelCache"
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
vi.mock("../openrouter", async (importOriginal) => ({
	...(await importOriginal<typeof import("../openrouter")>()),
	getOpenRouterModelEndpoints: vi.fn(),
}))
vi.mock("@roo-code/telemetry", () => ({ TelemetryService: { instance: { captureEvent: vi.fn() } } }))

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

it.each(["catalog request", "synchronous model metadata"] as const)(
	"repairs a cached OpenCode Go context window for a cold %s",
	async (caller) => {
		const opencodeOptions = { provider: providerIdentifiers.opencodeGo } as const
		const staleCatalog: ModelRecord = {
			"deepseek-v4.1-flash": { contextWindow: 200_000, maxTokens: 96_000, supportsPromptCache: true },
			"new-chat-model": { contextWindow: 150_000, maxTokens: 24_000, supportsPromptCache: false },
		}
		try {
			fetchModels.mockResolvedValue(staleCatalog)
			await refreshModels(opencodeOptions, handler)
			await flushModels(opencodeOptions, handler)
			fetchModels.mockClear().mockRejectedValue(new Error("Provider offline"))

			const models =
				caller === "catalog request"
					? await getModels(opencodeOptions, handler)
					: getModelsFromCache(opencodeOptions, handler)

			expect(models).toEqual({
				...staleCatalog,
				"deepseek-v4.1-flash": { ...staleCatalog["deepseek-v4.1-flash"], contextWindow: 1_000_000 },
			})
			expect(fetchModels).not.toHaveBeenCalled()
		} finally {
			await flushModels(opencodeOptions, handler)
		}
	},
)

it("retains both LiteLLM output token capabilities in the disk cache", async () => {
	const liteOptions = { provider: providerIdentifiers.litellm, baseUrl: "http://localhost:4000" } as const
	const liteCatalog = {
		modern: { contextWindow: 32768, supportsPromptCache: false, requiresMaxCompletionTokens: true },
		legacy: { contextWindow: 32768, supportsPromptCache: false, requiresMaxCompletionTokens: false },
	}
	try {
		fetchModels.mockResolvedValue(liteCatalog)
		await refreshModels(liteOptions, handler)
		await flushModels(liteOptions, handler)
		fetchModels.mockClear()

		await expect(getModels(liteOptions, handler)).resolves.toEqual(liteCatalog)
		expect(fetchModels).not.toHaveBeenCalled()
	} finally {
		await flushModels(liteOptions, handler)
	}
})

const routerReadCases = [
	["memory", "getModel"],
	["disk", "getModel"],
	["memory", "fetchModel"],
	["disk", "fetchModel"],
] as const

it.each(routerReadCases)(
	"copies only the router's selected model from the %s catalog through %s",
	async (storageKind, method) => {
		const modelId = "team-chat"
		const baseUrl = "http://127.0.0.1:4000"
		const apiKey = "cache-test-key"
		const request = { provider: providerIdentifiers.litellm, baseUrl, apiKey } as const
		const model = {
			maxTokens: 1024,
			contextWindow: 32768,
			supportsPromptCache: false,
			requiresMaxCompletionTokens: true,
		}
		const models = { [modelId]: model, "other-model": { ...model, maxTokens: 2048 } }
		const makeRouter = (litellmModelId = modelId) =>
			new LiteLLMHandler({ litellmModelId, litellmBaseUrl: baseUrl, litellmApiKey: apiKey })
		const source = makeRouter()
		const fetch = vi.spyOn(source, "fetchModels").mockResolvedValue(models)
		try {
			await refreshModels(request, source)
			if (storageKind === "disk") await flushModels(request, source)
			fetch.mockClear().mockRejectedValue(new Error("Provider offline"))
			const router = makeRouter()
			const routerFetch = vi.spyOn(router, "fetchModels").mockRejectedValue(new Error("Provider offline"))
			const clone = vi.spyOn(globalThis, "structuredClone")
			try {
				const result = await router[method]()
				expect(result).toEqual({ id: modelId, info: model })
				expect(router.getModel().info).toBe(result.info)
				const unavailable = makeRouter("missing-model")
				expect(unavailable.getModel()).toMatchObject({
					id: "missing-model",
					info: { inputPrice: 0, outputPrice: 0 },
				})
				expect(clone.mock.calls).toEqual([[model]])
				result.info.maxTokens = 12
			} finally {
				clone.mockRestore()
			}
			expect(makeRouter().getModel().info).toEqual(model)
			await expect(getModels(request, source)).resolves.toEqual(models)
			expect(fetch).not.toHaveBeenCalled()
			expect(routerFetch).not.toHaveBeenCalled()
		} finally {
			await flushModels(request, source)
		}
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

it.each([true, false])("reports whether an unlisted selection has a populated catalog (%s)", async (hasModels) => {
	fetchModels.mockResolvedValueOnce(hasModels ? catalog : {})

	await expect(getCatalogModel(options, handler, "vendor/unlisted")).resolves.toEqual({ model: undefined, hasModels })
	expect(fetchModels).toHaveBeenCalledTimes(1)
})

it("reopens the saved endpoint list for the requested model when its live list is empty", async () => {
	const { getModelEndpoints } = await import("../modelEndpointCache")
	const getEndpoints = vi.mocked(getOpenRouterModelEndpoints).mockClear()
	const endpointOptions = {
		router: providerIdentifiers.openrouter,
		modelId: "vendor/model",
		endpoint: "test-endpoint",
	}
	getEndpoints.mockResolvedValueOnce(endpoints)
	await expect(getModelEndpoints(endpointOptions, handler)).resolves.toEqual(endpoints)
	expect(await readdir(join(customStoragePath, "cache"))).toContain("openrouter_vendormodel_endpoints.json")

	vi.useFakeTimers({ toFake: ["Date"] })
	try {
		vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1)
		getEndpoints.mockResolvedValue({})
		const saved = await getModelEndpoints(endpointOptions, handler)
		expect(saved).toEqual(endpoints)
		saved["test-endpoint"].maxTokens = 12
		await expect(getModelEndpoints(endpointOptions, handler)).resolves.toEqual(endpoints)
		expect(getEndpoints).toHaveBeenCalledTimes(2)

		vi.setSystemTime(Date.now() + 30_001)
		const recovered = { "test-endpoint": { ...endpoints["test-endpoint"], maxTokens: 8192 } }
		getEndpoints.mockResolvedValueOnce(recovered)
		await expect(getModelEndpoints(endpointOptions, handler)).resolves.toEqual(recovered)
		expect(getEndpoints).toHaveBeenCalledTimes(3)
	} finally {
		vi.useRealTimers()
		getEndpoints.mockReset()
	}
})

it("keeps retained endpoint lists scoped to the configured storage directory", async () => {
	const { getModelEndpoints } = await import("../modelEndpointCache")
	const getEndpoints = vi.mocked(getOpenRouterModelEndpoints).mockReset().mockResolvedValue({})
	const customPath = customStoragePath
	const diskFile = "openrouter_vendorfallback-storage_endpoints.json"
	const selection = {
		router: providerIdentifiers.openrouter,
		modelId: "vendor/fallback-storage",
		endpoint: "test-endpoint",
	} as const
	const defaults = { "test-endpoint": { ...endpoints["test-endpoint"], maxTokens: 8192 } }
	try {
		for (const [directory, catalog] of [
			[customPath, endpoints],
			[storage.global, defaults],
		] as const) {
			await mkdir(join(directory, "cache"), { recursive: true })
			await writeFile(join(directory, "cache", diskFile), JSON.stringify(catalog))
		}

		await expect(getModelEndpoints(selection, handler)).resolves.toEqual(endpoints)
		customStoragePath = ""
		await expect(getModelEndpoints(selection, handler)).resolves.toEqual(defaults)
		customStoragePath = customPath
		await expect(getModelEndpoints(selection, handler)).resolves.toEqual(endpoints)
		expect(getEndpoints).toHaveBeenCalledTimes(2)
	} finally {
		getEndpoints.mockReset()
	}
})

it.each([undefined, "test-endpoint"])("copies one OpenRouter model with endpoint %s", async (pin) => {
	const modelId = "vendor/selected"
	const baseUrl = "https://selection.example.test/api/v1"
	const request = { provider: providerIdentifiers.openrouter, baseUrl } as const
	const model: ModelInfo = {
		contextWindow: 65536,
		maxTokens: 4096,
		supportsPromptCache: false,
		supportsReasoningEffort: ["low", "high"],
		supportedParameters: ["reasoning", "temperature"],
	}
	const models = { [modelId]: model, "vendor/sibling": { ...model, maxTokens: 6553 } }
	const makeRouter = (endpoint?: string) =>
		new OpenRouterHandler({
			openRouterModelId: modelId,
			openRouterBaseUrl: baseUrl,
			openRouterSpecificProvider: endpoint,
		})
	const source = makeRouter()
	const fetch = vi.spyOn(source, "fetchModels").mockResolvedValueOnce(models)
	try {
		await refreshModels(request, source)
		const router = makeRouter(pin)
		const unexpectedFetch = vi.spyOn(router, "fetchModels").mockRejectedValue(new Error("Provider offline"))
		vi.mocked(getOpenRouterModelEndpoints)
			.mockClear()
			.mockResolvedValueOnce({
				"test-endpoint": { contextWindow: 32768, maxTokens: 2048, supportsPromptCache: false },
			})
		const clone = vi.spyOn(globalThis, "structuredClone")
		try {
			const selected = await router.fetchModel()
			expect(selected.id).toBe(modelId)
			expect(selected.info.contextWindow).toBe(pin ? 32768 : 65536)
			expect(selected.info.supportedParameters).toEqual(model.supportedParameters)
			expect(selected.info.supportsReasoningEffort).toEqual(model.supportsReasoningEffort)
			expect(clone.mock.calls).toEqual(pin ? [[model], [{ [pin]: selected.info }]] : [[model]])
			selected.info.supportedParameters?.push("max_tokens")
		} finally {
			clone.mockRestore()
		}
		await expect(getModels(request, source)).resolves.toEqual(models)
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(unexpectedFetch).not.toHaveBeenCalled()
		expect(getOpenRouterModelEndpoints).toHaveBeenCalledTimes(pin ? 1 : 0)
	} finally {
		vi.mocked(getOpenRouterModelEndpoints).mockReset()
		await flushModels(request, source)
	}
})

it("reopens each custom OpenRouter endpoint list from its own disk cache", async () => {
	const { getModelEndpoints } = await import("../modelEndpointCache")
	const selection = {
		router: providerIdentifiers.openrouter,
		modelId: "vendor/regional-model",
		endpoint: "test-endpoint",
	}
	const first = { ...selection, baseUrl: "https://first.example.test/api/v1" }
	const second = { ...selection, baseUrl: "https://second.example.test/api/v1" }
	const firstEndpoints: ModelRecord = { "test-endpoint": { contextWindow: 16384, supportsPromptCache: false } }
	const secondEndpoints: ModelRecord = { "test-endpoint": { contextWindow: 32768, supportsPromptCache: false } }
	vi.mocked(getOpenRouterModelEndpoints).mockResolvedValueOnce(firstEndpoints).mockResolvedValueOnce(secondEndpoints)
	await expect(getModelEndpoints(first, handler)).resolves.toEqual(firstEndpoints)
	await expect(getModelEndpoints(second, handler)).resolves.toEqual(secondEndpoints)
	const files = await readdir(join(customStoragePath, "cache"))
	expect(files.filter((file) => file.endsWith("_endpoints.json"))).toHaveLength(2)

	vi.useFakeTimers({ toFake: ["Date"] })
	try {
		vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1)
		vi.mocked(getOpenRouterModelEndpoints).mockResolvedValueOnce({}).mockResolvedValueOnce({})
		await expect(getModelEndpoints(second, handler)).resolves.toEqual(secondEndpoints)
		await expect(getModelEndpoints({ ...first, baseUrl: `${first.baseUrl}/` }, handler)).resolves.toEqual(
			firstEndpoints,
		)
	} finally {
		vi.useRealTimers()
	}
})
