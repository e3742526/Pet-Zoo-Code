import * as path from "path"
import fs from "fs/promises"
import { createHash } from "node:crypto"

import NodeCache from "node-cache"
import sanitize from "sanitize-filename"

import { providerIdentifiers, type ModelRecord } from "@roo-code/types"

import { ContextProxy } from "../../../core/config/ContextProxy"
import type { RouterName } from "../../../shared/api"
import { getCacheDirectoryPath, getCustomStoragePath } from "../../../utils/storage"
import { fileExistsAtPath } from "../../../utils/fs"
import { safeWriteJson } from "../../../utils/safeWriteJson"

import { getOpenRouterModelEndpoints } from "./openrouter"
import { getCatalogModel } from "./modelCache"
import type { ApiHandler } from "../../index"

/** In-memory endpoint cache. Entries live 5 minutes and are checked on the same interval. */
const memoryCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })
/** Short TTL for fallback results, so a failed discovery is retried soon. */
const ENDPOINT_FALLBACK_TTL_SECONDS = 30
/** Parent catalog loads in flight, keyed by cache scope, so concurrent callers share one request. */
const pendingCatalogs = new Map<string, Promise<ModelRecord>>()

/**
 * Builds the disk cache file key. A custom base URL is hashed with the model ID,
 * so endpoints from different OpenRouter-compatible proxies never share a file.
 */
function getDiskKey(router: RouterName, modelId: string, baseUrl?: string): string {
	if (baseUrl === undefined) return sanitize(`${router}_${modelId}`)
	const scope = createHash("sha256")
		.update(JSON.stringify([baseUrl, modelId]))
		.digest("hex")
	return `${router}_${scope}`
}

type StorageScope = { globalPath: string; customPath: string }

function getStorageScope(): StorageScope | undefined {
	try {
		return { globalPath: ContextProxy.instance.globalStorageUri.fsPath, customPath: getCustomStoragePath() }
	} catch {
		return undefined
	}
}

async function getEndpointCacheFile(diskKey: string, storage: StorageScope): Promise<string> {
	const cacheDir = await getCacheDirectoryPath(storage.globalPath, storage.customPath)
	return path.join(cacheDir, `${diskKey}_endpoints.json`)
}

async function readModelEndpoints(diskKey: string, storage: StorageScope): Promise<ModelRecord | undefined> {
	const filePath = await getEndpointCacheFile(diskKey, storage)
	const exists = await fileExistsAtPath(filePath)
	return exists ? JSON.parse(await fs.readFile(filePath, "utf8")) : undefined
}

export const getModelEndpoints = async (
	{
		router,
		modelId,
		endpoint,
		baseUrl,
	}: {
		router: RouterName
		modelId?: string
		endpoint?: string
		baseUrl?: string
	},
	handler: ApiHandler,
	parentLoad?: ReturnType<typeof getCatalogModel>,
): Promise<ModelRecord> => {
	// OpenRouter is the only provider that supports model endpoints, but you
	// can see how we'd extend this to other providers in the future.
	if (router !== providerIdentifiers.openrouter || !modelId || !endpoint) {
		return {}
	}

	const normalizedUrl = baseUrl ? baseUrl.replace(/\/+$/, "") : undefined
	const liveKey = JSON.stringify([router, modelId, normalizedUrl])
	const live = memoryCache.get<ModelRecord>(liveKey)
	if (live) return live

	const storage = getStorageScope()
	const fallbackKey = JSON.stringify([liveKey, storage?.globalPath, storage?.customPath])
	const fallback = memoryCache.get<ModelRecord>(fallbackKey)
	if (fallback) return fallback

	let pending = pendingCatalogs.get(fallbackKey)
	if (!pending) {
		pending = loadModelEndpoints(
			{ liveKey, fallbackKey, diskKey: getDiskKey(router, modelId, normalizedUrl), modelId, baseUrl, storage },
			handler,
			parentLoad,
		).finally(() => {
			pendingCatalogs.delete(fallbackKey)
		})
		pendingCatalogs.set(fallbackKey, pending)
	}
	return structuredClone(await pending)
}

async function loadModelEndpoints(
	{
		liveKey,
		fallbackKey,
		diskKey,
		modelId,
		baseUrl,
		storage,
	}: {
		liveKey: string
		fallbackKey: string
		diskKey: string
		modelId: string
		baseUrl?: string
		storage?: StorageScope
	},
	handler: ApiHandler,
	parentLoad?: ReturnType<typeof getCatalogModel>,
): Promise<ModelRecord> {
	const modelProviders = baseUrl
		? await getOpenRouterModelEndpoints(modelId, { openRouterBaseUrl: baseUrl }, { untrustedBaseUrl: true })
		: await getOpenRouterModelEndpoints(modelId)

	const endpoints = Object.values(modelProviders)
	if (endpoints.length === 0) {
		if (!storage) return {}

		try {
			const fallback = await readModelEndpoints(diskKey, storage)
			if (fallback && Object.keys(fallback).length > 0) {
				memoryCache.set(fallbackKey, fallback, ENDPOINT_FALLBACK_TTL_SECONDS)
				return fallback
			}
		} catch (error) {
			console.error(`[getModelProviders] error reading ${diskKey} endpoints from file cache`, error)
		}
		return {}
	}

	// These capabilities apply to every endpoint. Give each endpoint its own arrays.
	const { model: parentModel } = await (parentLoad ??
		getCatalogModel({ provider: providerIdentifiers.openrouter, baseUrl }, handler, modelId))
	if (parentModel) {
		const { supportsReasoningEffort, supportedParameters } = parentModel
		for (const endpointInfo of endpoints) {
			endpointInfo.supportsReasoningEffort = Array.isArray(supportsReasoningEffort)
				? [...supportsReasoningEffort]
				: supportsReasoningEffort
			endpointInfo.supportedParameters = supportedParameters?.slice()
		}
	}

	memoryCache.set(liveKey, modelProviders)
	memoryCache.del(fallbackKey)
	if (storage) {
		try {
			await safeWriteJson(await getEndpointCacheFile(diskKey, storage), modelProviders)
		} catch (error) {
			console.error(`[getModelProviders] error writing ${diskKey} endpoints to file cache`, error)
		}
	}

	return modelProviders
}
