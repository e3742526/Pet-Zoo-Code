import * as vscode from "vscode"

import { toRequestyServiceUrl } from "../shared/utils/requesty"

import { getRouterUnavailableSignInMessage } from "../core/config/routerRemoval"
import { ClineProvider } from "../core/webview/ClineProvider"
import { t } from "../i18n"

export const handleUri = async (uri: vscode.Uri) => {
	const path = uri.path
	const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"))
	const visibleProvider = ClineProvider.getVisibleInstance()

	switch (path) {
		case "/openrouter": {
			if (query.has("code")) {
				void vscode.window.showInformationMessage(t("common:openRouterSignIn.retry"))
			}
			break
		}
		case "/requesty": {
			if (!visibleProvider) return
			const code = query.get("code")
			const baseUrl = query.get("baseUrl")
			if (code) {
				// Deep links are untrusted. Require consent before installing credentials
				// or redirecting an existing task's conversation to this destination.
				// Remove user info. "router.requesty.ai@evil.example" has the host evil.example.
				const destination = new URL(toRequestyServiceUrl(baseUrl))
				destination.username = ""
				destination.password = ""
				const approve = t("common:answers.activate_requesty")
				// JSON.stringify quotes and escapes the URL. This stops control characters
				// in the untrusted baseUrl from faking dialog text.
				const choice = await vscode.window.showWarningMessage(
					t("common:confirmation.requesty_deep_link"),
					{
						modal: true,
						detail: t("common:confirmation.requesty_deep_link_detail", {
							url: JSON.stringify(destination.toString()),
						}),
					},
					approve,
				)
				if (choice === approve) {
					await visibleProvider.handleRequestyCallback(code, baseUrl)
				}
			}
			break
		}
		case "/auth/clerk/callback": {
			vscode.window.showInformationMessage(getRouterUnavailableSignInMessage())
			break
		}
		default:
			break
	}
}
