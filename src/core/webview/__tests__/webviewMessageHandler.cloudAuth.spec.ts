import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import type { WebviewMessage } from "@roo-code/types"

import type { ClineProvider } from "../ClineProvider"
import { webviewMessageHandler } from "../webviewMessageHandler"

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
}))

describe("legacy Roo Cloud webview messages", () => {
	const unavailable = "Roo Code Cloud sign-in is currently unavailable. Configure another provider to continue."
	const postMessageToWebview = vi.fn<ClineProvider["postMessageToWebview"]>()
	const postStateToWebview = vi.fn<ClineProvider["postStateToWebview"]>()
	// The compatibility handlers use only these methods to reply to the webview.
	const provider = { postMessageToWebview, postStateToWebview } as unknown as ClineProvider

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it.each<WebviewMessage>([
		{ type: "rooCloudSignIn", useProviderSignup: true },
		{ type: "cloudLandingPageSignIn", text: "legacy-page" },
		{ type: "rooCloudManualUrl", text: "vscode://ZooCodeOrganization.zoo-code/auth/clerk/callback?code=old" },
	])("tells an older webview that $type is unavailable", async (message) => {
		await webviewMessageHandler(provider, message)

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(unavailable)
		expect(postMessageToWebview).not.toHaveBeenCalled()
	})

	it("clears the older webview's signed-in state", async () => {
		await webviewMessageHandler(provider, { type: "rooCloudSignOut" })

		expect(postStateToWebview).toHaveBeenCalledOnce()
		expect(postMessageToWebview).toHaveBeenCalledWith({ type: "authenticatedUser", userInfo: undefined })
	})

	it("replies with a failure when an older webview tries to switch organizations", async () => {
		await webviewMessageHandler(provider, { type: "switchOrganization", organizationId: "old-org" })

		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "organizationSwitchResult",
			success: false,
			error: unavailable,
			organizationId: "old-org",
		})
	})
})
