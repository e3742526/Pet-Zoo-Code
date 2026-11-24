import { providerIdentifiers } from "@roo-code/types"
import { Package } from "@roo/package"

export function getCallbackUrl(provider: string, uriScheme?: string) {
	return encodeURIComponent(`${uriScheme || "vscode"}://${Package.publisher}.${Package.name}/${provider}`)
}

export function getOpenRouterAuthUrl(uriScheme?: string) {
	return `https://openrouter.ai/auth?callback_url=${getCallbackUrl(providerIdentifiers.openrouter, uriScheme)}`
}

/** @internal Exported for focused implementation tests. */
export function getRequestyAuthUrl(uriScheme?: string) {
	return `https://app.requesty.ai/oauth/authorize?callback_url=${getCallbackUrl(providerIdentifiers.requesty, uriScheme)}`
}
