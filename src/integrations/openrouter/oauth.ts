import { createHash, randomBytes } from "node:crypto"
import * as vscode from "vscode"
import { z } from "zod"

import { OPENROUTER_API_BASE_URL } from "@roo-code/types"

import { t } from "../../i18n"

const responseSchema = z.object({ key: z.string().trim().min(1) })

export async function requestOpenRouterAuthorization(): Promise<{ code: string; verifier: string } | undefined> {
	const verifier = randomBytes(32).toString("base64url")
	const challenge = createHash("sha256").update(verifier).digest("base64url")
	const url = new URL("/auth", OPENROUTER_API_BASE_URL)
	url.searchParams.set("code_challenge", challenge)
	url.searchParams.set("code_challenge_method", "S256")
	url.searchParams.set("key_label", "Dory Code")
	if (!(await vscode.env.openExternal(vscode.Uri.parse(url.href)))) {
		throw new Error("Cannot open OpenRouter sign-in.")
	}

	const code = (
		await vscode.window.showInputBox({
			prompt: t("common:openRouterSignIn.pasteCode"),
			ignoreFocusOut: true,
			password: true,
		})
	)?.trim()
	return code ? { code, verifier } : undefined
}

export async function exchangeOpenRouterAuthorization(code: string, verifier: string): Promise<string> {
	const response = await fetch(`${OPENROUTER_API_BASE_URL}/auth/keys`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
		redirect: "error",
		signal: AbortSignal.timeout(15_000),
	})
	if (!response.ok) {
		throw new Error("OpenRouter rejected the authorization code.")
	}
	return responseSchema.parse(await response.json()).key
}
