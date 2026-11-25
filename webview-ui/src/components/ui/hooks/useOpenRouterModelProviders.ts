import { useQuery, type UseQueryOptions } from "@tanstack/react-query"

import { OPENROUTER_API_BASE_URL, type ProviderInfoResultMap } from "@roo-code/types"

import { requestProviderInfo } from "./requestProviderInfo"

export { OPENROUTER_DEFAULT_PROVIDER_NAME } from "@roo-code/types"

const ENDPOINT_STALE_TIME_MS = 30_000
const EMPTY_ENDPOINT_STALE_TIME_MS = 5_000

type OpenRouterModelProvider = ProviderInfoResultMap["openRouterModelProviders"][string]

async function getOpenRouterProvidersForModel(modelId: string, baseUrl?: string) {
	try {
		return await requestProviderInfo("openRouterModelProviders", {
			modelId,
			baseUrl,
		})
	} catch (error) {
		console.error(`Error fetching OpenRouter providers:`, error)
		return {}
	}
}

type UseOpenRouterModelProvidersOptions = Omit<
	UseQueryOptions<Record<string, OpenRouterModelProvider>>,
	"queryKey" | "queryFn"
>

export const useOpenRouterModelProviders = (
	modelId?: string,
	baseUrl?: string,
	options?: UseOpenRouterModelProvidersOptions,
) =>
	useQuery<Record<string, OpenRouterModelProvider>>({
		queryKey: ["openrouter-model-providers", modelId, (baseUrl || OPENROUTER_API_BASE_URL).replace(/\/+$/, "")],
		queryFn: () => (modelId ? getOpenRouterProvidersForModel(modelId, baseUrl) : {}),
		staleTime: ({ state }) =>
			state.data && Object.keys(state.data).length > 0 ? ENDPOINT_STALE_TIME_MS : EMPTY_ENDPOINT_STALE_TIME_MS,
		...options,
	})
