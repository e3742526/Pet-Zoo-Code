const { mockShowWarningMessage } = vi.hoisted(() => ({
	mockShowWarningMessage:
		vi.fn<
			(
				message: string,
				options: import("vscode").MessageOptions,
				...items: string[]
			) => Promise<string | undefined>
		>(),
}))

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: mockShowWarningMessage,
	},
}))

// i18next loads no locale resources in the test environment, so t() would return
// the key. Resolve keys from the en bundle so dialog text and interpolation match
// production behavior.
vi.mock("../../i18n", async () => {
	const { default: enCommon } = await import("../../i18n/locales/en/common.json")
	return {
		t: (key: string, options?: Record<string, unknown>) => {
			const template = key
				.replace(/^common:/, "")
				.split(".")
				.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], enCommon)
			return typeof template === "string"
				? template.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) => String(options?.[name] ?? match))
				: key
		},
	}
})

import * as vscode from "vscode"

const { mockGetVisibleInstance, mockVisibleProvider } = vi.hoisted(() => {
	// Visible provider double provides the Requesty callback.
	const mockVisibleProvider = {
		handleRequestyCallback: vi.fn(),
	} as unknown as ClineProvider

	return {
		mockGetVisibleInstance: vi.fn((): ClineProvider | null => mockVisibleProvider),
		mockVisibleProvider,
	}
})

vi.mock("../../core/webview/ClineProvider", () => ({
	ClineProvider: {
		getVisibleInstance: mockGetVisibleInstance,
	},
}))

import { handleUri } from "../handleUri"
import { toRequestyServiceUrl } from "../../shared/utils/requesty"
import type { ClineProvider } from "../../core/webview/ClineProvider"

const makeUri = (uri: Pick<vscode.Uri, "path" | "query">): vscode.Uri => uri as vscode.Uri

describe("handleUri", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockShowWarningMessage.mockResolvedValue(undefined)
		mockGetVisibleInstance.mockReturnValue(mockVisibleProvider)
	})

	it("passes Requesty codes without losing literal plus signs", async () => {
		mockShowWarningMessage.mockResolvedValue("Activate Requesty")
		await handleUri(makeUri({ path: "/requesty", query: "code=a+b%2Bc&baseUrl=https%3A%2F%2Fexample.com" }))
		expect(mockVisibleProvider.handleRequestyCallback).toHaveBeenCalledWith("a+b+c", "https://example.com")
	})

	it("directs old OpenRouter callbacks to the new sign-in flow", async () => {
		await handleUri(makeUri({ path: "/openrouter", query: "code=test-code" }))
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			"Start OpenRouter sign-in again from settings or enter an API key.",
		)
		expect(mockVisibleProvider.handleRequestyCallback).not.toHaveBeenCalled()
	})

	it("passes null when Requesty has no base URL", async () => {
		mockShowWarningMessage.mockImplementation(async () => "Activate Requesty")
		await handleUri(makeUri({ path: "/requesty", query: "code=test-code" }))
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			"Activate Requesty credentials from an external link?",
			expect.objectContaining({ modal: true, detail: expect.stringContaining("https://router.requesty.ai/v1") }),
			"Activate Requesty",
		)
		expect(mockVisibleProvider.handleRequestyCallback).toHaveBeenCalledWith("test-code", null)
	})

	it.each(["not-a-url", "ftp://x.example", ""])(
		"shows the resolved destination for invalid baseUrl %s and passes the raw value",
		async (baseUrl) => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
			mockShowWarningMessage.mockImplementation(async () => "Activate Requesty")
			try {
				await handleUri(
					makeUri({ path: "/requesty", query: `code=test-code&baseUrl=${encodeURIComponent(baseUrl)}` }),
				)
			} finally {
				warn.mockRestore()
			}
			// The dialog shows what toRequestyServiceUrl resolves (the default on fallback),
			// while the callback receives the raw value for consumers to resolve again.
			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				"Activate Requesty credentials from an external link?",
				expect.objectContaining({
					modal: true,
					detail: expect.stringContaining(JSON.stringify(toRequestyServiceUrl(baseUrl))),
				}),
				"Activate Requesty",
			)
			expect(mockVisibleProvider.handleRequestyCallback).toHaveBeenCalledWith("test-code", baseUrl)
		},
	)

	it.each([
		["https://router.requesty.ai@evil.example/v1", ["router.requesty.ai"]],
		["https://u:p%40ss@evil.example/v1", ["u:", "p%40ss", "p@ss"]],
	])("shows only the real host when the baseUrl %s has user info", async (baseUrl, hidden) => {
		mockShowWarningMessage.mockImplementation(async () => undefined)
		await handleUri(makeUri({ path: "/requesty", query: `code=k&baseUrl=${encodeURIComponent(baseUrl)}` }))
		const options = mockShowWarningMessage.mock.calls[0][1]
		expect(options.detail).toContain('"https://evil.example/v1"')
		for (const text of hidden) expect(options.detail).not.toContain(text)
	})

	it.each([undefined, "Cancel"])(
		"does not apply an unsolicited Requesty callback when dismissed with %s",
		async (choice) => {
			mockShowWarningMessage.mockImplementation(async () => choice)
			await handleUri(
				makeUri({ path: "/requesty", query: "code=attacker-key&baseUrl=https://attacker.example/v1" }),
			)
			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				"Activate Requesty credentials from an external link?",
				expect.objectContaining({
					modal: true,
					detail: expect.stringContaining("https://attacker.example/v1"),
				}),
				"Activate Requesty",
			)
			expect(mockVisibleProvider.handleRequestyCallback).not.toHaveBeenCalled()
		},
	)

	it("waits for explicit approval before applying callback credentials", async () => {
		let approve: (choice: string | undefined) => void = () => {}
		mockShowWarningMessage.mockImplementation(
			() =>
				new Promise<string | undefined>((resolve) => {
					approve = resolve
				}),
		)
		let settled = false
		const callback = handleUri(makeUri({ path: "/requesty", query: "code=test-code" })).then(() => {
			settled = true
		})
		await new Promise((resolve) => setTimeout(resolve, 0))
		// handleUri must wait for the dialog. It must not return early.
		expect(settled).toBe(false)
		expect(mockVisibleProvider.handleRequestyCallback).not.toHaveBeenCalled()
		approve("Activate Requesty")
		await callback
		expect(settled).toBe(true)
		expect(mockVisibleProvider.handleRequestyCallback).toHaveBeenCalledWith("test-code", null)
	})

	it("ignores Requesty when no provider is visible", async () => {
		mockGetVisibleInstance.mockReturnValue(null)
		await handleUri(makeUri({ path: "/requesty", query: "code=test-code" }))
		expect(mockVisibleProvider.handleRequestyCallback).not.toHaveBeenCalled()
	})

	it.each(["/openrouter", "/requesty", "/auth-callback", "/unknown"])(
		"ignores %s without callback credentials",
		async (path) => {
			await handleUri(makeUri({ path, query: "" }))
			expect(mockVisibleProvider.handleRequestyCallback).not.toHaveBeenCalled()
		},
	)

	it("ignores legacy cloud auth callback", async () => {
		await handleUri(
			makeUri({
				path: "/auth/clerk/callback",
				query: "code=test-code&state=test-state&organizationId=test-org",
			}),
		)

		expect(mockVisibleProvider.handleRequestyCallback).not.toHaveBeenCalled()
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			"Roo Code Cloud sign-in is currently unavailable. Configure another provider to continue.",
		)
	})

	it("ignores credentials sent to the retired Zoo login callback", async () => {
		await handleUri(makeUri({ path: "/auth-callback", query: "token=retired-token" }))

		expect(mockVisibleProvider.handleRequestyCallback).not.toHaveBeenCalled()
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
	})
})
