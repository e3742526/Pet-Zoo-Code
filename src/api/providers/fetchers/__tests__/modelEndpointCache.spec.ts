// npx vitest run api/providers/fetchers/__tests__/modelEndpointCache.spec.ts

import { vi, describe, it, expect, beforeEach } from "vitest"

import { providerIdentifiers, type ModelInfo, type ModelRecord } from "@roo-code/types"

import { getModelEndpoints } from "../modelEndpointCache"
import * as modelCache from "../modelCache"
import * as openrouter from "../openrouter"
import type { ApiHandler } from "../../../index"

vi.mock("../modelCache")
vi.mock("../openrouter")

const handler = {
	fetchModels: vi.fn(),
	getModelCacheScope: () => ({ urlScoped: false, keyScoped: false, authScoped: false }),
} as unknown as ApiHandler

describe("modelEndpointCache", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getModelEndpoints", () => {
		it("shares discovery across simultaneous selections of endpoints for the same model", async () => {
			const getEndpoints = vi.mocked(openrouter.getOpenRouterModelEndpoints)
			let finish!: (models: ModelRecord) => void
			getEndpoints.mockReturnValue(new Promise<ModelRecord>((resolve) => (finish = resolve)))
			const baseUrl = "https://overlap.example.test/api/v1"
			const selection = {
				router: providerIdentifiers.openrouter,
				modelId: "test/overlap",
				endpoint: "pinned",
				baseUrl,
			} as const
			const parent = Promise.resolve({ model: undefined, hasModels: true })
			const pending = [
				getModelEndpoints(selection, handler, parent),
				getModelEndpoints({ ...selection, endpoint: "alternate", baseUrl: baseUrl + "/" }, handler, parent),
			]
			const endpoints = {
				pinned: { contextWindow: 4096, supportsPromptCache: false },
				alternate: { contextWindow: 8192, supportsPromptCache: false },
			}
			finish(endpoints)
			const [first, second] = await Promise.all(pending)
			expect(getEndpoints).toHaveBeenCalledOnce()
			expect(first).toEqual(endpoints)
			expect(second).toEqual(endpoints)
			expect(first.pinned).not.toBe(second.pinned)
		})

		it("allows a new load after parent metadata fails", async () => {
			const getCatalogModel = vi.mocked(modelCache.getCatalogModel)
			const getEndpoints = vi.mocked(openrouter.getOpenRouterModelEndpoints)
			const selection = {
				router: providerIdentifiers.openrouter,
				modelId: "test/retry",
				endpoint: "pinned",
			} as const
			const endpoints = { pinned: { contextWindow: 4096, supportsPromptCache: false } }
			getEndpoints.mockResolvedValue(endpoints)
			getCatalogModel
				.mockRejectedValueOnce(new Error("parent unavailable"))
				.mockResolvedValueOnce({ model: undefined, hasModels: false })

			await expect(getModelEndpoints(selection, handler)).rejects.toThrow("parent unavailable")
			await expect(getModelEndpoints(selection, handler)).resolves.toEqual(endpoints)
			expect(getEndpoints).toHaveBeenCalledTimes(2)
		})

		it("keeps live endpoint requests separate for model IDs that share a legacy filename", async () => {
			const getEndpoints = vi.mocked(openrouter.getOpenRouterModelEndpoints)
			getEndpoints
				.mockResolvedValueOnce({ pinned: { contextWindow: 4096, supportsPromptCache: false } })
				.mockResolvedValueOnce({ pinned: { contextWindow: 8192, supportsPromptCache: false } })
			const selection = { router: providerIdentifiers.openrouter, endpoint: "pinned" } as const
			const parent = Promise.resolve({ model: undefined, hasModels: true })

			const [first, second] = await Promise.all([
				getModelEndpoints({ ...selection, modelId: "test/filename" }, handler, parent),
				getModelEndpoints({ ...selection, modelId: "testf/ilename" }, handler, parent),
			])
			expect(first.pinned.contextWindow).toBe(4096)
			expect(second.pinned.contextWindow).toBe(8192)
			expect(getEndpoints).toHaveBeenCalledTimes(2)
		})

		it("keeps model endpoint metadata and parent models separate for custom URLs", async () => {
			const getCatalogModel = vi.mocked(modelCache.getCatalogModel).mockResolvedValue({
				model: undefined,
				hasModels: false,
			})
			const getEndpoints = vi.mocked(openrouter.getOpenRouterModelEndpoints)
			getEndpoints.mockResolvedValueOnce({ pinned: { contextWindow: 4096, supportsPromptCache: false } })
			getEndpoints.mockResolvedValueOnce({ pinned: { contextWindow: 8192, supportsPromptCache: false } })
			const firstUrl = "https://first.example.test/api/v1"
			const secondUrl = "https://second.example.test/api/v1"
			const selection = {
				router: providerIdentifiers.openrouter,
				modelId: "test/scoped-model",
				endpoint: "pinned",
			} as const
			const first = { ...selection, baseUrl: firstUrl }
			const second = { ...selection, baseUrl: secondUrl }

			expect((await getModelEndpoints(first, handler)).pinned.contextWindow).toBe(4096)
			expect((await getModelEndpoints(second, handler)).pinned.contextWindow).toBe(8192)
			expect((await getModelEndpoints(first, handler)).pinned.contextWindow).toBe(4096)
			expect(getEndpoints.mock.calls).toEqual(
				[firstUrl, secondUrl].map((baseUrl) => [
					selection.modelId,
					{ openRouterBaseUrl: baseUrl },
					{ untrustedBaseUrl: true },
				]),
			)
			expect(getCatalogModel.mock.calls).toEqual(
				[firstUrl, secondUrl].map((baseUrl) => [
					{ provider: providerIdentifiers.openrouter, baseUrl },
					handler,
					selection.modelId,
				]),
			)
		})

		it("should copy model-level capabilities from parent model to endpoints", async () => {
			// Mock the parent model data with capabilities
			const parentModel: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				supportsReasoningEffort: true,
				supportedParameters: ["max_tokens", "temperature", "reasoning"],
				inputPrice: 3,
				outputPrice: 15,
			}

			// Mock endpoint data WITHOUT capabilities (as returned by API)
			const mockEndpoints: ModelRecord = {
				anthropic: {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 3,
					outputPrice: 15,
					// Note: No supportsReasoningEffort, or supportedParameters
				},
				"amazon-bedrock": {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 3,
					outputPrice: 15,
				},
			}

			vi.mocked(modelCache.getCatalogModel).mockResolvedValue({ model: parentModel, hasModels: true })
			vi.mocked(openrouter.getOpenRouterModelEndpoints).mockResolvedValue(mockEndpoints)

			const result = await getModelEndpoints(
				{
					router: providerIdentifiers.openrouter,
					modelId: "anthropic/claude-sonnet-4",
					endpoint: "anthropic",
				},
				handler,
			)

			// Verify capabilities were copied from parent to ALL endpoints
			expect(result.anthropic.supportsReasoningEffort).toBe(true)
			expect(result.anthropic.supportedParameters).toEqual(["max_tokens", "temperature", "reasoning"])

			expect(result["amazon-bedrock"].supportsReasoningEffort).toBe(true)
			expect(result["amazon-bedrock"].supportedParameters).toEqual(["max_tokens", "temperature", "reasoning"])
		})

		it("should create independent array copies to avoid shared references", async () => {
			const parentModel: ModelInfo = {
				maxTokens: 1000,
				contextWindow: 10000,
				supportsPromptCache: false,
				supportedParameters: ["max_tokens", "temperature"],
				supportsReasoningEffort: ["low", "high"],
			}

			const mockEndpoints: ModelRecord = {
				"endpoint-1": {
					maxTokens: 1000,
					contextWindow: 10000,
					supportsPromptCache: false,
				},
				"endpoint-2": {
					maxTokens: 1000,
					contextWindow: 10000,
					supportsPromptCache: false,
				},
			}

			const parentLoad = Promise.resolve({ model: parentModel, hasModels: true })
			vi.mocked(openrouter.getOpenRouterModelEndpoints).mockResolvedValue(mockEndpoints)

			const result = await getModelEndpoints(
				{
					router: providerIdentifiers.openrouter,
					modelId: "test/model",
					endpoint: "endpoint-1",
				},
				handler,
				parentLoad,
			)

			// Modify one endpoint's array
			result["endpoint-1"].supportedParameters?.push("reasoning")

			// Verify the other endpoint's array was NOT affected (independent copy)
			expect(result["endpoint-1"].supportedParameters).toHaveLength(3)
			expect(result["endpoint-2"].supportedParameters).toHaveLength(2)
			expect(result["endpoint-1"].supportsReasoningEffort).toEqual(parentModel.supportsReasoningEffort)
			expect(result["endpoint-1"].supportsReasoningEffort).not.toBe(parentModel.supportsReasoningEffort)
			expect(result["endpoint-1"].supportsReasoningEffort).not.toBe(result["endpoint-2"].supportsReasoningEffort)
			expect(modelCache.getCatalogModel).not.toHaveBeenCalled()
		})

		it("should handle missing parent model gracefully", async () => {
			const mockEndpoints: ModelRecord = {
				anthropic: {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
				},
			}

			vi.mocked(modelCache.getCatalogModel).mockResolvedValue({ model: undefined, hasModels: false })
			vi.mocked(openrouter.getOpenRouterModelEndpoints).mockResolvedValue(mockEndpoints)

			const result = await getModelEndpoints(
				{
					router: providerIdentifiers.openrouter,
					modelId: "missing/model",
					endpoint: "anthropic",
				},
				handler,
			)

			// Should not crash, but copied capabilities will be undefined
			expect(result.anthropic).toBeDefined()
			expect(result.anthropic.supportedParameters).toBeUndefined()
		})

		it("should return empty object for non-openrouter providers", async () => {
			const result = await getModelEndpoints(
				{
					router: providerIdentifiers.vercelAiGateway,
					modelId: "claude-sonnet-4",
					endpoint: "default",
				},
				handler,
			)

			expect(result).toEqual({})
		})

		it("should return empty object when modelId or endpoint is missing", async () => {
			const result1 = await getModelEndpoints(
				{
					router: providerIdentifiers.openrouter,
					modelId: undefined,
					endpoint: "anthropic",
				},
				handler,
			)

			const result2 = await getModelEndpoints(
				{
					router: providerIdentifiers.openrouter,
					modelId: "anthropic/claude-sonnet-4",
					endpoint: undefined,
				},
				handler,
			)

			expect(result1).toEqual({})
			expect(result2).toEqual({})
		})
	})
})
