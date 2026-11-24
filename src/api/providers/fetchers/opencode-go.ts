import axios from "axios"
import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"
import { opencodeGoDefaultModelInfo, getOpencodeGoModelInfo } from "@roo-code/types"

import { throwIfAborted } from "../utils/abort-signal"

const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1"

// The current catalog uses nested limits, input modalities, and a model type.
// Older responses can contain flat metadata or only an ID.
const opencodeGoModelSchema = z.object({
	id: z.string(),
	type: z.string().optional(),
	name: z.string().optional(),
	description: z.string().optional(),
	limit: z.object({ context: z.number().optional(), output: z.number().optional() }).optional(),
	modalities: z.object({ input: z.array(z.string()).optional() }).optional(),
	context_window: z.number().optional(),
	context_length: z.number().optional(),
	max_tokens: z.number().optional(),
	max_output_tokens: z.number().optional(),
	supports_images: z.boolean().optional(),
})

export type OpencodeGoModel = z.infer<typeof opencodeGoModelSchema>

const opencodeGoModelsResponseSchema = z.object({
	data: z.array(opencodeGoModelSchema),
})

/**
 * Maps a raw Opencode Go model entry to the internal {@link ModelInfo} shape.
 *
 * The registry supplies curated context windows, reasoning settings, and pricing.
 * Live metadata supplies output limits and image support when present. Unknown
 * models use the live context window or the provider default.
 *
 * @param model - Validated model entry from the `/models` response.
 * @returns Normalised model metadata suitable for the model picker.
 */
export const parseOpencodeGoModel = (model: OpencodeGoModel): ModelInfo => {
	const native = getOpencodeGoModelInfo(model.id)

	const liveMaxTokens = model.limit?.output ?? model.max_output_tokens ?? model.max_tokens
	const liveSupportsImages =
		model.modalities?.input?.some((modality) => modality === "image" || modality.startsWith("image/")) ??
		model.supports_images

	if (native) {
		return {
			...native,
			...(liveMaxTokens !== undefined && { maxTokens: liveMaxTokens }),
			...(liveSupportsImages !== undefined && { supportsImages: liveSupportsImages }),
			description: model.description ?? model.name ?? native.description,
		}
	}

	return {
		maxTokens: liveMaxTokens ?? opencodeGoDefaultModelInfo.maxTokens,
		contextWindow:
			model.limit?.context ??
			model.context_window ??
			model.context_length ??
			opencodeGoDefaultModelInfo.contextWindow,
		supportsImages: liveSupportsImages ?? false,
		supportsPromptCache: false,
		description: model.description ?? model.name,
	}
}

/**
 * Fetches the list of available models from the Opencode Go `/models` endpoint.
 *
 * The endpoint shape mirrors the OpenAI `/models` response. A permissive Zod
 * schema is used so that unknown fields are silently dropped rather than
 * causing a hard failure. Invalid entries (e.g. missing `id`) are skipped
 * with a console warning rather than propagated to the UI.
 *
 * @param apiKey - Optional Bearer token for authenticated requests.
 * @param opts - Optional per-request controls; `signal` cancels the in-flight request.
 * @returns A record mapping model IDs to their normalised {@link ModelInfo}.
 */
export async function getOpencodeGoModels(
	apiKey?: string,
	opts?: { signal?: AbortSignal },
): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get(`${OPENCODE_GO_BASE_URL}/models`, {
			headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
			signal: opts?.signal,
		})

		const result = opencodeGoModelsResponseSchema.safeParse(response.data)
		const rawData = result.success ? result.data.data : response.data?.data
		const data = Array.isArray(rawData) ? rawData : []

		if (!result.success) {
			console.warn(
				`Opencode Go models response did not match expected schema; falling back to per-item parsing: ${JSON.stringify(result.error.format())}`,
			)
		}

		for (const rawModel of data) {
			const parsed = opencodeGoModelSchema.safeParse(rawModel)
			if (!parsed.success) {
				console.warn(`Skipping invalid Opencode Go model entry: ${JSON.stringify(rawModel)}`)
				continue
			}
			const model = parsed.data
			if (model.type !== undefined && model.type !== "chat") {
				continue
			}
			models[model.id] = parseOpencodeGoModel(model)
		}
	} catch (error) {
		// Surface cancellation as a rejection: logging and returning here would
		// present an aborted fetch to callers as a successful (partial) catalog.
		throwIfAborted(opts?.signal)

		console.error(`Error fetching Opencode Go models: ${error instanceof Error ? error.message : String(error)}`)
	}

	return models
}
