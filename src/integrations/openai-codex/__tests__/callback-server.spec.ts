import type { AddressInfo } from "net"
import nock from "nock"

import { allowNetConnect } from "../../../vitest.setup"
import { OPENAI_CODEX_OAUTH_CONFIG, OpenAiCodexOAuthManager } from "../oauth"

describe("OpenAI Codex OAuth callback server", () => {
	const originalPort = OPENAI_CODEX_OAUTH_CONFIG.callbackPort

	beforeEach(() => {
		// Use any free port so the test does not depend on port 1455.
		Reflect.set(OPENAI_CODEX_OAUTH_CONFIG, "callbackPort", 0)
		allowNetConnect(/(::1|127\.0\.0\.1)/)
	})

	afterEach(() => {
		Reflect.set(OPENAI_CODEX_OAUTH_CONFIG, "callbackPort", originalPort)
		nock.disableNetConnect()
	})

	it("listens on loopback only and returns echoed errors as plain text", async () => {
		const manager = new OpenAiCodexOAuthManager()
		manager.startAuthorizationFlow()
		const rejection = expect(manager.waitForCallback()).rejects.toThrow("OAuth error")

		const server = await vi.waitFor(() => {
			const current = manager["pendingAuth"]?.server
			if (!current) throw new Error("Server is not listening yet")
			return current
		})
		const { address, port } = server.address() as AddressInfo
		expect(["127.0.0.1", "::1"]).toContain(address)

		const host = address === "::1" ? "[::1]" : address
		const response = await fetch(`http://${host}:${port}/auth/callback?error=%3Cscript%3E1%3C%2Fscript%3E`)

		expect(response.status).toBe(400)
		expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
		expect(response.headers.get("x-content-type-options")).toBe("nosniff")
		await rejection
	})
})
