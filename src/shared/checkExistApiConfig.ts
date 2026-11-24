import {
	SECRET_STATE_KEYS,
	GLOBAL_SECRET_KEYS,
	isRetiredProvider,
	providerIdentifiers,
	ProviderSettings,
} from "@roo-code/types"

/**
 * Returns whether a provider profile is sufficiently configured to leave the
 * welcome/setup gate.
 */
export function checkExistKey(config: ProviderSettings | undefined) {
	if (!config || (config.apiProvider && isRetiredProvider(config.apiProvider))) {
		return false
	}

	// Special case for providers which don't need any configuration. Muse Code and Antigravity use
	// the sign-in of their locally installed CLI.
	const configurationFreeProviders: ProviderSettings["apiProvider"][] = [
		providerIdentifiers.fakeAi,
		providerIdentifiers.openaiCodex,
		providerIdentifiers.qwenCode,
		providerIdentifiers.museCode,
		providerIdentifiers.antigravity,
	]
	if (config.apiProvider && configurationFreeProviders.includes(config.apiProvider)) {
		return true
	}

	if (config.apiProvider === providerIdentifiers.kimiCode && (config.kimiCodeAuthMethod ?? "oauth") === "oauth") {
		return true
	}

	// Check all secret keys from the centralized SECRET_STATE_KEYS array.
	// Filter out keys that are not part of ProviderSettings (global secrets are stored separately)
	const providerSecretKeys = SECRET_STATE_KEYS.filter(
		(key) => !(GLOBAL_SECRET_KEYS as readonly string[]).includes(key),
	)
	const hasSecretKey = providerSecretKeys.some((key) => config[key as keyof ProviderSettings] !== undefined)

	// Check additional non-secret configuration properties
	const hasOtherConfig = [
		config.awsRegion,
		config.vertexProjectId,
		config.ollamaModelId,
		config.lmStudioModelId,
		config.vsCodeLmModelSelector,
	].some((value) => value !== undefined)

	return hasSecretKey || hasOtherConfig
}
