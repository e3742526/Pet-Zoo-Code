import { Package } from "@roo/package"

import { getCallbackUrl, getRequestyAuthUrl } from "../urls"

describe("OAuth URLs", () => {
	it.each([undefined, "", "vscode-insiders", "cursor"])("encodes callback URLs for scheme %s", (scheme) => {
		expect(getCallbackUrl("auth-callback", scheme)).toBe(
			encodeURIComponent(`${scheme || "vscode"}://${Package.publisher}.${Package.name}/auth-callback`),
		)
	})

	it.each([[getRequestyAuthUrl, "https://app.requesty.ai/oauth/authorize", "requesty"]] as const)(
		"preserves the endpoint and provider callback for %s",
		(getAuthUrl, endpoint, identifier) => {
			for (const scheme of [undefined, "", "vscode-insiders", "cursor"]) {
				const callback = `${scheme || "vscode"}://${Package.publisher}.${Package.name}/${identifier}`
				expect(getAuthUrl(scheme)).toBe(`${endpoint}?callback_url=${encodeURIComponent(callback)}`)
				expect(new URL(getAuthUrl(scheme)).searchParams.get("callback_url")).toBe(callback)
			}
		},
	)
})
