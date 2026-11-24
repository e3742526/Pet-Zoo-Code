import { providerIdentifiers } from "@roo-code/types"
import * as assert from "assert"

import { setDefaultSuiteTimeout } from "../test-utils"
import { waitUntilCompleted } from "../utils"

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

type CapturedOpenRouterRequest = {
	appTitle: string | null
	httpReferer: string | null
	userAgent: string | null
	userMessageContent?: unknown
}

function getRequestUrl(input: RequestInfo | URL): string {
	return typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url
}

function installOpenRouterRequestCapture(capture: CapturedOpenRouterRequest[], baseUrl: string): () => void {
	const originalFetch = globalThis.fetch
	const target = new URL(`${baseUrl.replace(/\/+$/, "")}/chat/completions`)

	globalThis.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const url = getRequestUrl(input)

		try {
			const request = new URL(url)
			if (request.origin === target.origin && request.pathname === target.pathname) {
				let userMessageContent: unknown
				if (typeof init?.body === "string") {
					const body = JSON.parse(init.body)
					const messages: Array<{ role?: string; content?: unknown }> = body.messages ?? []
					userMessageContent = messages.reverse().find((message) => message.role === "user")?.content
				}
				const headers = new Headers(init?.headers)
				capture.push({
					appTitle: headers.get("X-OpenRouter-Title") ?? headers.get("X-Title"),
					httpReferer: headers.get("HTTP-Referer"),
					userAgent: headers.get("User-Agent"),
					userMessageContent,
				})
			}
		} catch {
			// Ignore invalid capture data and let fetch handle the request.
		}

		return originalFetch.call(globalThis, input, init as RequestInit)
	} as typeof globalThis.fetch

	return () => {
		globalThis.fetch = originalFetch
	}
}

suite("OpenRouter provider", function () {
	setDefaultSuiteTimeout(this)

	let restoreFetch: (() => void) | undefined
	const requests: CapturedOpenRouterRequest[] = []

	setup(function () {
		const aimockUrl = process.env.AIMOCK_URL
		if (!aimockUrl && !OPENROUTER_API_KEY) {
			this.skip()
		}
	})

	suiteSetup(async () => {
		const aimockUrl = process.env.AIMOCK_URL
		const isRecord = process.env.AIMOCK_RECORD === "true"
		const baseUrl = aimockUrl ? `${aimockUrl}/v1` : "https://openrouter.ai/api/v1"

		restoreFetch = installOpenRouterRequestCapture(requests, baseUrl)

		await globalThis.api.setConfiguration({
			apiProvider: providerIdentifiers.openrouter,
			openRouterApiKey: aimockUrl && !isRecord ? "mock-key" : OPENROUTER_API_KEY!,
			openRouterModelId: "anthropic/claude-haiku-4-5",
			...(aimockUrl && { openRouterBaseUrl: `${aimockUrl}/v1` }),
		})
	})

	suiteTeardown(() => {
		restoreFetch?.()
		restoreFetch = undefined
	})

	test("Should forward base64 images as image_url content parts in outbound request", async () => {
		requests.length = 0

		// 8x8 red PNG (1x1 is too small and rejected by Anthropic's vision API)
		const base64Png =
			"iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC"
		const dataUri = `data:image/png;base64,${base64Png}`

		const api = globalThis.api
		const taskId = await api.startNewTask({
			configuration: { mode: "ask", autoApprovalEnabled: true },
			text: "openrouter-image-e2e: describe the image in one word.",
			images: [dataUri],
		})

		await waitUntilCompleted({ api, taskId })

		// Find the first request that contains the probe tag
		const probeRequest = requests.find((r) => {
			const content = r.userMessageContent
			return Array.isArray(content) && JSON.stringify(content).includes("openrouter-image-e2e")
		})

		assert.ok(probeRequest, "Should have captured an outbound request containing the probe tag")

		const content = probeRequest.userMessageContent as Array<{ type: string; image_url?: { url: string } }>
		const imagePart = content.find((p) => p.type === "image_url")
		assert.ok(imagePart, "User message should contain an image_url content part")
		assert.strictEqual(
			imagePart?.image_url?.url,
			dataUri,
			"image_url.url should be the original data URI passed via startNewTask",
		)
	})

	test("Sends the fork's user agent without app attribution headers", async () => {
		requests.length = 0

		const api = globalThis.api
		const taskId = await api.startNewTask({
			configuration: { mode: "ask", autoApprovalEnabled: true },
			text: "openrouter-identity-smoke: what is 2+2? Reply with only the number.",
		})

		await waitUntilCompleted({ api, taskId })

		// Check all requests captured during the task — not just requests[0] — so that
		// background OpenRouter traffic before the task cannot mask a failure on the
		// actual task request.
		assert.ok(requests.length > 0, "OpenRouter provider should issue at least one outbound request")
		for (const captured of requests) {
			assert.strictEqual(captured.appTitle, null)
			assert.strictEqual(captured.httpReferer, null)
			assert.match(captured.userAgent ?? "", /^PetZooCode\//)
		}
	})
})
