import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as vscode from "vscode"

import { exchangeOpenRouterAuthorization, requestOpenRouterAuthorization } from "../oauth"

vi.mock("vscode", () => ({
	env: { openExternal: vi.fn() },
	Uri: { parse: vi.fn((uri: string) => uri) },
	window: { showInputBox: vi.fn() },
}))

vi.mock("../../../i18n", () => ({ t: (key: string) => key }))

describe("OpenRouter sign-in", () => {
	const fetchMock = vi.fn<typeof fetch>()
	const openExternal = vi.mocked(vscode.env.openExternal)
	const showInputBox = vi.mocked(vscode.window.showInputBox)

	beforeEach(() => {
		fetchMock.mockReset()
		openExternal.mockReset().mockResolvedValue(true)
		showInputBox.mockReset().mockResolvedValue("  mock-authorization-code  ")
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => vi.unstubAllGlobals())

	it("opens OpenRouter with a challenge and exchanges the code with its matching verifier", async () => {
		fetchMock.mockResolvedValue(Response.json({ key: "mock-api-key" }))
		const authorization = await requestOpenRouterAuthorization()
		assert(authorization)
		const url = new URL(String(openExternal.mock.calls[0][0]))
		expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth")
		expect(url.searchParams.get("code_challenge_method")).toBe("S256")
		expect(url.searchParams.get("code_challenge")).toBe(
			createHash("sha256").update(authorization.verifier).digest("base64url"),
		)
		expect(url.searchParams.has("callback_url")).toBe(false)
		expect(url.href).not.toContain(authorization.verifier)
		expect(showInputBox).toHaveBeenCalledWith(expect.objectContaining({ password: true, ignoreFocusOut: true }))
		expect(await exchangeOpenRouterAuthorization(authorization.code, authorization.verifier)).toBe("mock-api-key")
		expect(fetchMock).toHaveBeenCalledWith(
			"https://openrouter.ai/api/v1/auth/keys",
			expect.objectContaining({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) }),
		)
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
			code: "mock-authorization-code",
			code_challenge_method: "S256",
			code_verifier: authorization.verifier,
		})
	})

	it.each([undefined, ""])("ends sign-in when the code prompt returns %s", async (code) => {
		showInputBox.mockResolvedValue(code)
		await expect(requestOpenRouterAuthorization()).resolves.toBeUndefined()
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("ends sign-in if the browser cannot open", async () => {
		openExternal.mockResolvedValue(false)
		await expect(requestOpenRouterAuthorization()).rejects.toThrow("Cannot open OpenRouter sign-in")
		expect(showInputBox).not.toHaveBeenCalled()
	})

	it.each([Response.json({}, { status: 403 }), Response.json({ key: " " })])(
		"rejects a response without a valid API key (status $status)",
		async (response) => {
			fetchMock.mockResolvedValue(response)
			await expect(exchangeOpenRouterAuthorization("mock-code", "mock-verifier")).rejects.toThrow()
		},
	)
})
