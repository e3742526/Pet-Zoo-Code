import {
	anthropicModels,
	getAgentProfileModelId,
	providerIdentifiers,
	type NativeAgentAuth,
	type NativeEngineId,
	type OrganizationAllowList,
	type ProviderSettingsWithId,
} from "@roo-code/types"

import { ProfileValidator } from "../../shared/ProfileValidator"

type Profile = ProviderSettingsWithId & { name: string }

export function engineForProvider(provider: Profile["apiProvider"]): NativeEngineId | undefined {
	switch (provider) {
		case providerIdentifiers.openaiCodex:
		case providerIdentifiers.openaiNative:
			return "codex"
		case providerIdentifiers.anthropic:
			return "claude-agent"
		default:
			return undefined
	}
}

export function resolveAgentConnection(
	profile: Profile,
	allowList: OrganizationAllowList,
	selectedRoute: NativeAgentAuth | undefined = profile.nativeAgentAuth,
) {
	const engine = engineForProvider(profile.apiProvider)
	const model = getAgentProfileModelId(profile)
	if (!engine || !profile.id || !model) throw new Error("Select a supported native provider profile and model.")
	if (!selectedRoute) throw new Error("Choose a native billing route in provider settings.")
	if (!ProfileValidator.isProfileAllowed({ ...profile, apiModelId: model }, allowList)) {
		throw new Error("Your organization policy excludes this provider or model.")
	}
	let apiKey: string | undefined
	if (profile.apiProvider === providerIdentifiers.openaiNative) {
		if (selectedRoute !== "api-key" || profile.openAiNativeBaseUrl) {
			throw new Error("This profile requires the direct OpenAI API key route.")
		}
		apiKey = profile.openAiNativeApiKey
	}
	if (profile.apiProvider === providerIdentifiers.openaiCodex && selectedRoute !== "subscription") {
		throw new Error("This profile requires the Codex CLI subscription route.")
	}
	if (profile.apiProvider === providerIdentifiers.anthropic) {
		if (profile.anthropicBaseUrl) throw new Error("Claude Agent requires a direct Anthropic profile.")
		if (!Object.hasOwn(anthropicModels, model)) throw new Error("Select a direct Anthropic model for Claude Agent.")
		if (selectedRoute === "api-key") {
			if (profile.anthropicUseAuthToken)
				throw new Error("Claude Agent requires an Anthropic API key for this route.")
			apiKey = profile.apiKey
		}
	}
	if (selectedRoute === "api-key" && !apiKey) throw new Error("Add the API key to this provider profile.")
	return { engine, model, route: selectedRoute, profileId: profile.id, connection: profile.name, apiKey }
}
