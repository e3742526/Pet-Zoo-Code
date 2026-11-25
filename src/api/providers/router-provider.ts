import OpenAI from "openai"

import { type ModelInfo, type ModelRecord } from "@roo-code/types"

import { ApiHandlerOptions, RouterName } from "../../shared/api"

import { BaseProvider } from "./base-provider"
import { getModelFromCache, getModels, refreshModels } from "./fetchers/modelCache"
import { detachOnAbort } from "./utils/abort-signal"

import { DEFAULT_HEADERS, NOT_PROVIDED } from "./constants"

type RouterProviderOptions = {
	name: RouterName
	baseURL: string
	apiKey?: string
	modelId?: string
	defaultModelId: string
	defaultModelInfo: ModelInfo
	options: ApiHandlerOptions
}

export abstract class RouterProvider extends BaseProvider {
	protected readonly options: ApiHandlerOptions
	protected readonly name: RouterName
	protected models: ModelRecord = {}
	protected readonly modelId?: string
	protected readonly defaultModelId: string
	protected readonly defaultModelInfo: ModelInfo
	protected readonly apiKey?: string
	protected readonly client: OpenAI

	constructor({ options, name, baseURL, apiKey, modelId, defaultModelId, defaultModelInfo }: RouterProviderOptions) {
		super()

		this.options = options
		this.name = name
		this.modelId = modelId
		this.defaultModelId = defaultModelId
		this.defaultModelInfo = defaultModelInfo
		this.apiKey = apiKey

		this.client = new OpenAI({
			baseURL,
			apiKey: apiKey ?? NOT_PROVIDED,
			defaultHeaders: {
				...DEFAULT_HEADERS,
				...(options.openAiHeaders || {}),
			},
			timeout: this.timeoutMs,
		})
	}

	private modelFetchPromise?: Promise<{ id: string; info: ModelInfo }>
	/** Last attempt for a missing model or stale metadata, for negative caching. */
	private modelRefreshAttemptAt = new Map<string, number>()
	private static readonly MODEL_REFRESH_RETRY_MS = 5 * 60 * 1000

	protected isCatalogModelCurrent(info: ModelInfo | undefined): boolean {
		return Boolean(info)
	}

	public async fetchModel() {
		const id = this.modelId || this.defaultModelId
		if (this.isCatalogModelCurrent(this.models[id])) {
			return this.getModel()
		}

		// Allow a request to proceed with fallback metadata if a recent refresh could not update it.
		const lastAttempt = this.modelRefreshAttemptAt.get(id)
		if (lastAttempt !== undefined && Date.now() - lastAttempt < RouterProvider.MODEL_REFRESH_RETRY_MS) {
			return this.getModel()
		}

		if (!this.modelFetchPromise) {
			const fetchOptions = {
				provider: this.name,
				apiKey: this.apiKey,
				baseUrl: this.client.baseURL,
			}

			this.modelFetchPromise = (async () => {
				let models = await getModels(fetchOptions, this)
				this.models = models

				// A cached catalog can predate this model or one of its capabilities.
				// refreshModels retains the cached catalog if the proxy is unavailable.
				if (!this.isCatalogModelCurrent(models[id])) {
					models = await refreshModels(fetchOptions, this)
					this.models = models
				}

				if (this.isCatalogModelCurrent(models[id])) {
					this.modelRefreshAttemptAt.delete(id)
				} else {
					this.modelRefreshAttemptAt.set(id, Date.now())
				}
				return this.getModel()
			})().finally(() => {
				this.modelFetchPromise = undefined
			})
		}

		return this.modelFetchPromise
	}

	async ensureModelFetched(signal?: AbortSignal): Promise<void> {
		// A caller that already gave up must not start (or keep) a wait on the
		// shared catalog fetch.
		if (signal?.aborted) {
			throw signal.reason
		}

		const fetch = this.fetchModel()
		if (!signal) {
			await fetch
			return
		}

		// Detach this waiter as soon as the signal aborts; the shared in-flight
		// fetch continues for any other waiter and still populates the cache.
		await detachOnAbort(fetch, signal)
	}

	override getModel(): { id: string; info: ModelInfo } {
		// Use `||` (not `??`) so an empty-string modelId also falls back to the default,
		// guaranteeing a non-empty id rather than forwarding "" to the API as an invalid
		// request. Note this guarantees non-empty, not viable: defaultModelId is provider-
		// supplied and may not be a model that actually exists on the user's server (e.g.
		// OpenAI-compatible have no inherent default), so a configured-but-empty selection
		// can still resolve to a model the server rejects.
		const id = this.modelId || this.defaultModelId

		// First check instance models (populated by fetchModel)
		if (this.models[id]) {
			return { id, info: this.models[id] }
		}

		// Copy only the selected model from the synchronous disk/memory cache.
		// Pass the full options so URL-scoped providers (litellm, ollama, etc.)
		// resolve the same compound cache key that fetchModel() wrote under.
		const cachedModel = getModelFromCache(
			{
				provider: this.name,
				baseUrl: this.client.baseURL,
				apiKey: this.apiKey,
			},
			this,
			id,
		)
		if (cachedModel) {
			this.models = { [id]: cachedModel }
			return { id, info: cachedModel }
		}

		// Last resort: keep the configured id so we don't swap models, but zero
		// prices so we don't bill the UI with defaultModelInfo's $/token rates.
		if (id !== this.defaultModelId) {
			return {
				id,
				info: {
					...this.defaultModelInfo,
					inputPrice: 0,
					outputPrice: 0,
					cacheWritesPrice: 0,
					cacheReadsPrice: 0,
				},
			}
		}

		return { id, info: this.defaultModelInfo }
	}

	protected supportsTemperature(modelId: string): boolean {
		return !modelId.startsWith("openai/o3-mini")
	}
}
