// Compatibility facade for the OpenAI provider contract, native catalog, and compatible settings.
import { z } from "zod"

import { modelInfoSchema, type ModelInfo } from "../model.js"
import { providerIdentifiers } from "../provider-identifiers.js"
import {
	baseProviderSettingsShape,
	createModelIdAccessor,
	createProviderDefinition,
	NO_DEFAULT_MODEL_ID,
} from "./common.js"
import { openAiExtraBodySchema } from "./openai-compatible-settings.js"

export {
	OPENAI_API_PROTOCOL,
	OPENAI_NATIVE_DEFAULT_TEMPERATURE,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	type OpenAiNativeModelId,
} from "./openai-native-models.js"
export {
	OPENAI_AZURE_AI_INFERENCE_PATH,
	azureOpenAiDefaultApiVersion,
	isAzureAiInferenceBaseUrl,
	isAzureOpenAiBaseUrl,
	parseOpenAiExtraBody,
} from "./openai-compatible-settings.js"

// https://openai.com/api/pricing/
export const openAiModelsMessageTypes = ["requestOpenAiModels", "openAiModels"] as const

export const openAiModelsMessageTypeSchema = z.enum(openAiModelsMessageTypes)

export const OpenAiModelsMessageType = openAiModelsMessageTypeSchema.enum

export type OpenAiModelsMessageType = z.infer<typeof openAiModelsMessageTypeSchema>

// `maxTokens` is intentionally omitted so that no max output token limit is sent to the
// provider by default.
export const openAiModelInfoSaneDefaults: ModelInfo = {
	contextWindow: 128_000,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 0,
	outputPrice: 0,
}

export const OPEN_AI_MODEL_ID_FIELD = "openAiModelId"

export const DEFAULT_OPEN_AI_INCLUDE_MAX_TOKENS = true

/**
 * Default for the OpenAI `openAiStrictToolSchemas` setting.
 * When true (default), non-MCP tools are sent with strict: true and their
 * schemas are normalized for OpenAI strict mode. Some OpenAI-compatible
 * proxies reject strict: true; set this to false for those endpoints.
 */
export const DEFAULT_OPEN_AI_STRICT_TOOL_SCHEMAS = true

export const openAiProviderDefinition = createProviderDefinition({
	apiProvider: providerIdentifiers.openai,
	modelIdKey: OPEN_AI_MODEL_ID_FIELD,
	getModelId: createModelIdAccessor(OPEN_AI_MODEL_ID_FIELD),
	// OpenAI-compatible endpoints are fully user-configured, so there is no default.
	getDefaultModelId: () => NO_DEFAULT_MODEL_ID,
	schema: {
		...baseProviderSettingsShape,
		openAiBaseUrl: z.string().optional(),
		openAiApiKey: z.string().optional(),
		openAiR1FormatEnabled: z.boolean().optional(),
		openAiStrictToolSchemas: z.boolean().optional(),
		[OPEN_AI_MODEL_ID_FIELD]: z.string().optional(),
		openAiCustomModelInfo: modelInfoSchema.nullish(),
		openAiUseAzure: z.boolean().optional(),
		azureApiVersion: z.string().optional(),
		openAiStreamingEnabled: z.boolean().optional(),
		openAiUseResponsesApi: z.boolean().optional(),
		openAiHostHeader: z.string().optional(), // Keep temporarily for backward compatibility during migration.
		openAiHeaders: z.record(z.string(), z.string()).optional(),
		openAiExtraBody: openAiExtraBodySchema,
	},
})
