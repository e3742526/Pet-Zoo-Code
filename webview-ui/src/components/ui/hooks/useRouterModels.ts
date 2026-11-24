import { replaceEqualDeep, useQuery } from "@tanstack/react-query"

import {
	allRouterModelsProvider,
	providerIdentifiers,
	RouterModelsMessageType,
	type RouterModels,
	type ExtensionMessage,
} from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

type UseRouterModelsOptions = {
	provider?: string // single provider filter (e.g. "openrouter")
	enabled?: boolean // gate fetching entirely
	openRouterBaseUrl?: string // an empty string explicitly selects the public catalog
}

export const fetchRouterModels = async (provider?: string, signal?: AbortSignal, openRouterBaseUrl?: string) =>
	new Promise<RouterModels>((resolve, reject) => {
		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort)
			if (typeof window !== "undefined") {
				window.removeEventListener("message", handler)
			}
		}

		const onAbort = () => {
			clearTimeout(timeout)
			cleanup()
			reject(new DOMException("Router models request aborted", "AbortError"))
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("Router models request timed out"))
		}, 10000)

		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === RouterModelsMessageType.routerModels) {
				// Profiles and the settings draft can request the same provider from different URLs.
				if (provider !== message.values?.provider || openRouterBaseUrl !== message.values?.openRouterBaseUrl) {
					return
				}

				clearTimeout(timeout)
				cleanup()

				if (message.routerModels) {
					resolve(message.routerModels)
				} else {
					reject(new Error("No router models in response"))
				}
			}
		}

		if (signal?.aborted) {
			onAbort()
			return
		}

		signal?.addEventListener("abort", onAbort, { once: true })
		window.addEventListener("message", handler)
		if (provider) {
			vscode.postMessage({
				type: RouterModelsMessageType.requestRouterModels,
				values: { provider, ...(openRouterBaseUrl !== undefined && { openRouterBaseUrl }) },
			})
		} else {
			vscode.postMessage({ type: RouterModelsMessageType.requestRouterModels })
		}
	})

export const useRouterModels = (opts: UseRouterModelsOptions = {}) => {
	const provider = opts.provider || undefined
	const openRouterBaseUrl = provider === providerIdentifiers.openrouter ? opts.openRouterBaseUrl : undefined
	return useQuery({
		queryKey: [
			RouterModelsMessageType.routerModels,
			provider || allRouterModelsProvider,
			...(openRouterBaseUrl === undefined ? [] : [openRouterBaseUrl]),
		],
		queryFn: ({ signal }) => fetchRouterModels(provider, signal, openRouterBaseUrl),
		enabled: opts.enabled !== false,
		// Structural sharing copies into `{}`, where an own "__proto__" model ID would swap the
		// copy's prototype instead of becoming a key, so skip sharing for such catalogs.
		structuralSharing: (oldData, newData) =>
			hasOwnProtoModelId(newData) ? newData : replaceEqualDeep(oldData, newData),
	})
}

const hasOwnProtoModelId = (data: unknown): boolean =>
	typeof data === "object" &&
	data !== null &&
	Object.values(data).some(
		(models) => typeof models === "object" && models !== null && Object.hasOwn(models, "__proto__"),
	)
