// OpenAI native model catalog and defaults, re-exported by openai.ts.
// Extracted from providers/openai.ts.

import type { ModelInfo } from "../model.js"
import { gpt6Models } from "./openai-models-gpt6.js"
import { gpt5VariantModels } from "./openai-models-gpt5-variants.js"
import { legacyModels } from "./openai-models-legacy.js"

export type OpenAiNativeModelId = keyof typeof openAiNativeModels

export const OPENAI_API_PROTOCOL = "openai"
export const openAiNativeDefaultModelId: OpenAiNativeModelId = "gpt-5.6-sol"

export const OPENAI_NATIVE_DEFAULT_TEMPERATURE = 0

export const openAiNativeModels = {
	...gpt6Models,
	...gpt5VariantModels,
	...legacyModels,
} as const satisfies Record<string, ModelInfo>
