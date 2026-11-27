import { describe, expect, it } from "vitest"

import {
	discriminatedProviderSettingsWithIdSchema,
	getAgentProfileModelId,
	providerIdentifiers,
	type ProviderSettingsWithId,
} from "@roo-code/types"

import { engineForProvider, resolveAgentConnection } from "../eligibility"

describe("native engine compatibility", () => {
	const allowAll = { allowAll: true, providers: {} }
	const claude = {
		apiProvider: providerIdentifiers.anthropic,
		id: "profile",
		name: "Claude",
		agentEngine: "claude-agent",
		nativeAgentAuth: "subscription",
	} as const

	it("preserves preference and auth through provider-specific persistence", () => {
		const parsed = discriminatedProviderSettingsWithIdSchema.parse(claude)
		expect(parsed).toMatchObject({ id: "profile", agentEngine: "claude-agent", nativeAgentAuth: "subscription" })
		expect(resolveAgentConnection(claude, allowAll)).toMatchObject({
			engine: "claude-agent",
			route: "subscription",
		})
	})

	it.each([providerIdentifiers.antigravity, providerIdentifiers.openai, providerIdentifiers.openrouter])(
		"does not infer native capabilities from a %s model route",
		(apiProvider) => {
			expect(engineForProvider(apiProvider)).toBeUndefined()
		},
	)

	it("enforces the effective direct model and rejects custom endpoints", () => {
		const model = getAgentProfileModelId(claude)
		expect(model).toBeDefined()
		expect(() =>
			resolveAgentConnection(claude, { allowAll: false, providers: { anthropic: { allowAll: true } } }),
		).not.toThrow()
		expect(() =>
			resolveAgentConnection(claude, {
				allowAll: false,
				providers: { anthropic: { allowAll: false, models: ["other"] } },
			}),
		).toThrow(/policy/)
		expect(() =>
			resolveAgentConnection({ ...claude, anthropicBaseUrl: "https://gateway.invalid" }, allowAll),
		).toThrow(/direct/)
	})

	it("requires an explicit API route and key for direct OpenAI", () => {
		const config: ProviderSettingsWithId & { name: string } = {
			apiProvider: providerIdentifiers.openaiNative,
			id: "openai",
			name: "OpenAI",
		}
		expect(() => resolveAgentConnection(config, allowAll)).toThrow(/billing/)
		expect(() => resolveAgentConnection(config, allowAll, "subscription")).toThrow(/API key route/)
		expect(() => resolveAgentConnection(config, allowAll, "api-key")).toThrow(/Add the API key/)
	})
})
