import { providerIdentifiers } from "@roo-code/types"
import { Package } from "@roo/package"

export function getCallbackUrl(provider: string, uriScheme?: string) {
	return encodeURIComponent(`${uriScheme || "vscode"}://${Package.publisher}.${Package.name}/${provider}`)
}

/** @internal Exported for focused implementation tests. */
export function getRequestyAuthUrl(uriScheme?: string) {
	return `https://app.requesty.ai/oauth/authorize?callback_url=${getCallbackUrl(providerIdentifiers.requesty, uriScheme)}`
}
