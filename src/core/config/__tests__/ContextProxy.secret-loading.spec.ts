import type { SecretStorage } from "vscode"

import { GLOBAL_SECRET_KEYS, SECRET_STATE_KEYS } from "@roo-code/types"

import { makeEventEmitter, makeExtensionContext } from "../../../test-utils/vscode"
import { ContextProxy } from "../ContextProxy"

function localSecrets(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial))
	const secrets = {
		keys: vi.fn(async () => [...values.keys()]),
		get: vi.fn(async (key: string) => values.get(key)),
		store: vi.fn(async (key: string, value: string) => {
			values.set(key, value)
		}),
		delete: vi.fn(async (key: string) => {
			values.delete(key)
		}),
		onDidChange: makeEventEmitter<{ key: string }>().event,
	} satisfies SecretStorage & { keys(): Promise<string[]> }

	const proxy = new ContextProxy(makeExtensionContext({ secrets }))
	return { proxy, values, secrets }
}

describe("ContextProxy secret loading", () => {
	it("skips reads for an empty set of managed keys", async () => {
		const { proxy, secrets } = localSecrets({ "unrelated-profile-store": "fixture-profile" })

		await proxy.initialize()

		expect(secrets.keys).toHaveBeenCalledOnce()
		expect(secrets.get).not.toHaveBeenCalled()
		expect(proxy.isInitialized).toBe(true)
		expect(proxy.getSecret("apiKey")).toBeUndefined()
	})

	it("loads saved provider and global secrets from their existing keys", async () => {
		const { proxy, secrets } = localSecrets({
			ollamaApiKey: "fixture-local",
			openRouterImageApiKey: "fixture-image",
			"unrelated-profile-store": "fixture-profile",
		})

		await proxy.initialize()

		expect(secrets.get.mock.calls).toEqual([["ollamaApiKey"], ["openRouterImageApiKey"]])
		expect(proxy.getProviderSettings().ollamaApiKey).toBe("fixture-local")
		expect(proxy.getSecret("openRouterImageApiKey")).toBe("fixture-image")
		expect(secrets.store).not.toHaveBeenCalled()
	})

	it("uses direct reads if the storage implementation cannot list keys", async () => {
		const { proxy, secrets } = localSecrets({ openAiApiKey: "fixture-provider" })
		secrets.keys.mockRejectedValueOnce(new Error("Key listing unavailable"))

		await proxy.initialize()

		expect(secrets.get).toHaveBeenCalledTimes(SECRET_STATE_KEYS.length + GLOBAL_SECRET_KEYS.length)
		expect(proxy.getSecret("openAiApiKey")).toBe("fixture-provider")
	})

	it("refreshes newly stored keys and clears a previously cached key after deletion", async () => {
		const { proxy, values, secrets } = localSecrets({ openAiApiKey: "removed", apiKey: "" })
		await proxy.initialize()
		values.delete("openAiApiKey")
		values.delete("apiKey")
		values.set("ollamaApiKey", "fixture-new")
		secrets.get.mockClear()

		await proxy.refreshSecrets()

		expect(secrets.get.mock.calls).toEqual([["apiKey"], ["openAiApiKey"], ["ollamaApiKey"]])
		expect(proxy.getSecret("openAiApiKey")).toBeUndefined()
		expect(proxy.getSecret("apiKey")).toBeUndefined()
		expect(proxy.getSecret("ollamaApiKey")).toBe("fixture-new")
	})

	it("keeps a newer write made while listing keys", async () => {
		const { proxy, secrets } = localSecrets({ ollamaApiKey: "fixture-old" })
		await proxy.initialize()
		secrets.get.mockClear()

		let finishListing: (keys: string[]) => void = () => {}
		secrets.keys.mockImplementationOnce(() => new Promise((resolve) => (finishListing = resolve)))
		const refreshing = proxy.refreshSecrets()
		await proxy.storeSecret("ollamaApiKey", "fixture-new")
		finishListing(["ollamaApiKey"])
		await refreshing

		expect(proxy.getSecret("ollamaApiKey")).toBe("fixture-new")
		expect(secrets.get).not.toHaveBeenCalled()
	})
})
