import * as path from "path"
import fs from "fs/promises"
import { createHash } from "node:crypto"

import NodeCache from "node-cache"
import sanitize from "sanitize-filename"

import { providerIdentifiers, type ModelRecord } from "@roo-code/types"

import { ContextProxy } from "../../../core/config/ContextProxy"
import { RouterName } from "../../../shared/api"
import { getCacheDirectoryPath } from "../../../utils/storage"
import { fileExistsAtPath } from "../../../utils/fs"
import { safeWriteJson } from "../../../utils/safeWriteJson"

import { getOpenRouterModelEndpoints } from "./openrouter"
import { getCatalogModel } from "./modelCache"
import type { ApiHandler } from "../../index"

const memoryCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })

function getCacheKey(router: RouterName, modelId: string, baseUrl?: string): string {
	if (!baseUrl) return sanitize(`${router}_${modelId}`)
	const scope = createHash("sha256")
		.update(JSON.stringify([baseUrl.replace(/\/+$/, ""), modelId]))
		.digest("hex")
	return `${router}_${scope}`
}

async function writeModelEndpoints(key: string, data: ModelRecord) {
	const filename = `${key}_endpoints.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	await safeWriteJson(path.join(cacheDir, filename), data)
}

async function readModelEndpoints(key: string): Promise<ModelRecord | undefined> {
	const filename = `${key}_endpoints.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	const filePath = path.join(cacheDir, filename)
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

	const key = getCacheKey(router, modelId, baseUrl)
	let modelProviders = memoryCache.get<ModelRecord>(key)

	if (modelProviders) {
		// console.log(`[getModelProviders] NodeCache hit for ${key} -> ${Object.keys(modelProviders).length}`)
		return modelProviders
	}

	modelProviders = baseUrl
		? await getOpenRouterModelEndpoints(modelId, { openRouterBaseUrl: baseUrl }, { untrustedBaseUrl: true })
		: await getOpenRouterModelEndpoints(modelId)

	// Copy model-level capabilities from the parent model to each endpoint
	// These are capabilities that don't vary by provider (tools, reasoning, etc.)
	if (Object.keys(modelProviders).length > 0) {
		const { model: parentModel } = await (parentLoad ??
			getCatalogModel({ provider: providerIdentifiers.openrouter, baseUrl }, handler, modelId))

		if (parentModel) {
			// Copy model-level capabilities to all endpoints
			// Clone arrays to avoid shared mutable references
			const { supportsReasoningEffort, supportedParameters } = parentModel
			for (const endpointInfo of Object.values(modelProviders)) {
				endpointInfo.supportsReasoningEffort = Array.isArray(supportsReasoningEffort)
					? [...supportsReasoningEffort]
					: supportsReasoningEffort
				endpointInfo.supportedParameters = supportedParameters?.slice()
			}
		}
	}

	if (Object.keys(modelProviders).length > 0) {
		// console.log(`[getModelProviders] API fetch for ${key} -> ${Object.keys(modelProviders).length}`)
		memoryCache.set(key, modelProviders)

		try {
			await writeModelEndpoints(key, modelProviders)
			// console.log(`[getModelProviders] wrote ${key} endpoints to file cache`)
		} catch (error) {
			console.error(`[getModelProviders] error writing ${key} endpoints to file cache`, error)
		}

		return modelProviders
	}

	try {
		modelProviders = await readModelEndpoints(key)
		// console.log(`[getModelProviders] read ${key} endpoints from file cache`)
	} catch (error) {
		console.error(`[getModelProviders] error reading ${key} endpoints from file cache`, error)
	}

	return modelProviders ?? {}
}
