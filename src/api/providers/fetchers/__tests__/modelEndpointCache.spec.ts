// npx vitest run api/providers/fetchers/__tests__/modelEndpointCache.spec.ts

import { vi, describe, it, expect, beforeEach } from "vitest"

import { providerIdentifiers } from "@roo-code/types"

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
		it("keeps model endpoint metadata and parent models separate for custom URLs", async () => {
			const getModels = vi.mocked(modelCache.getModels).mockResolvedValue({})
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
			expect(getModels.mock.calls).toEqual(
				[firstUrl, secondUrl].map((baseUrl) => [
					{ provider: providerIdentifiers.openrouter, baseUrl },
					handler,
				]),
			)
		})

		it("should copy model-level capabilities from parent model to endpoints", async () => {
			// Mock the parent model data with capabilities
			const mockParentModels = {
				"anthropic/claude-sonnet-4": {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					supportsReasoningEffort: true,
					supportedParameters: ["max_tokens", "temperature", "reasoning"] as any,
					inputPrice: 3,
					outputPrice: 15,
				},
			}

			// Mock endpoint data WITHOUT capabilities (as returned by API)
			const mockEndpoints = {
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

			vi.spyOn(modelCache, "getModels").mockResolvedValue(mockParentModels as any)
			vi.spyOn(openrouter, "getOpenRouterModelEndpoints").mockResolvedValue(mockEndpoints as any)

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
			const mockParentModels = {
				"test/model": {
					maxTokens: 1000,
					contextWindow: 10000,
					supportsPromptCache: false,
					supportedParameters: ["max_tokens", "temperature"] as any,
				},
			}

			const mockEndpoints = {
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

			vi.spyOn(modelCache, "getModels").mockResolvedValue(mockParentModels as any)
			vi.spyOn(openrouter, "getOpenRouterModelEndpoints").mockResolvedValue(mockEndpoints as any)

			const result = await getModelEndpoints(
				{
					router: providerIdentifiers.openrouter,
					modelId: "test/model",
					endpoint: "endpoint-1",
				},
				handler,
			)

			// Modify one endpoint's array
			result["endpoint-1"].supportedParameters?.push("reasoning" as any)

			// Verify the other endpoint's array was NOT affected (independent copy)
			expect(result["endpoint-1"].supportedParameters).toHaveLength(3)
			expect(result["endpoint-2"].supportedParameters).toHaveLength(2)
		})

		it("should handle missing parent model gracefully", async () => {
			const mockParentModels = {}
			const mockEndpoints = {
				anthropic: {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
				},
			}

			vi.spyOn(modelCache, "getModels").mockResolvedValue(mockParentModels as any)
			vi.spyOn(openrouter, "getOpenRouterModelEndpoints").mockResolvedValue(mockEndpoints as any)

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
