import { z } from "zod"

import { type ModelInfo } from "../model.js"
import { providerIdentifiers } from "../provider-identifiers.js"
import {
	API_MODEL_ID_FIELD,
	apiModelIdProviderModelShape,
	createModelIdAccessor,
	createProviderDefinition,
} from "./common.js"

// Google Antigravity runs through the locally installed, subscription-authenticated `agy` CLI.
// Catalog qualified with `agy models` (agy 1.5.16). Antigravity encodes the reasoning effort in
// the model ID (for example `-medium`), so these models do not expose a separate effort control.
// The CLI does not publish context or output limits; the limits below are conservative estimates.
// Users can enter any other model ID that `agy models` lists.

export const ANTIGRAVITY_DEFAULT_EXECUTABLE = "agy"

const antigravityBaseModelInfo = {
	maxTokens: 32_768,
	contextWindow: 1_000_000,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 0,
	outputPrice: 0,
	cacheReadsPrice: 0,
	cacheWritesPrice: 0,
} as const satisfies ModelInfo

const gemini = (description: string): ModelInfo => ({ ...antigravityBaseModelInfo, description })
const claude = (description: string): ModelInfo => ({
	...antigravityBaseModelInfo,
	contextWindow: 200_000,
	description,
})

export const antigravityModels = {
	"gemini-4-neon-low": gemini("Gemini 4 Neon (Low effort) via Antigravity."),
	"gemini-4-neon-medium": gemini("Gemini 4 Neon (Medium effort) via Antigravity."),
	"gemini-4-neon-high": gemini("Gemini 4 Neon (High effort) via Antigravity."),
	"gemini-4-neon-xhigh": gemini("Gemini 4 Neon (XHigh effort) via Antigravity."),
	"gemini-4-carbon-low": gemini("Gemini 4 Carbon (Low effort) via Antigravity."),
	"gemini-4-carbon-medium": gemini("Gemini 4 Carbon (Medium effort) via Antigravity."),
	"gemini-4-carbon-high": gemini("Gemini 4 Carbon (High effort) via Antigravity."),
	"gemini-4-argon-low": gemini("Gemini 4 Argon (Low effort) via Antigravity."),
	"gemini-4-argon-medium": gemini("Gemini 4 Argon (Medium effort) via Antigravity."),
	"gemini-4-argon-high": gemini("Gemini 4 Argon (High effort) via Antigravity."),
	"gemini-4-hydrogen-low": gemini("Gemini 4 Hydrogen (Low effort) via Antigravity."),
	"gemini-4-hydrogen-medium": gemini("Gemini 4 Hydrogen (Medium effort) via Antigravity."),
	"gemini-4-hydrogen-high": gemini("Gemini 4 Hydrogen (High effort) via Antigravity."),
	"gemini-4-hydrogen-xhigh": gemini("Gemini 4 Hydrogen (XHigh effort) via Antigravity."),
	"gemini-3.8-flash-low": gemini("Gemini 3.8 Flash (Low effort) via Antigravity."),
	"gemini-3.8-flash-medium": gemini("Gemini 3.8 Flash (Medium effort) via Antigravity."),
	"gemini-3.8-flash-high": gemini("Gemini 3.8 Flash (High effort) via Antigravity."),
	"claude-opus-5-5-low": claude("Claude Opus 5.5 (Low effort) via Antigravity."),
	"claude-opus-5-5-medium": claude("Claude Opus 5.5 (Medium effort) via Antigravity."),
	"claude-opus-5-5-high": claude("Claude Opus 5.5 (High effort) via Antigravity."),
	"claude-sonnet-5-5-low": claude("Claude Sonnet 5.5 (Low effort) via Antigravity."),
	"claude-sonnet-5-5-medium": claude("Claude Sonnet 5.5 (Medium effort) via Antigravity."),
	"claude-sonnet-5-5-high": claude("Claude Sonnet 5.5 (High effort) via Antigravity."),
	"gpt-oss-120b-medium": {
		...antigravityBaseModelInfo,
		contextWindow: 131_072,
		description: "GPT-OSS 120B (Medium effort) via Antigravity.",
	},
} as const satisfies Record<string, ModelInfo>

export type AntigravityModelId = keyof typeof antigravityModels

export const antigravityDefaultModelId: AntigravityModelId = "gemini-4-neon-medium"

export const antigravityDefaultModelInfo: ModelInfo = antigravityModels[antigravityDefaultModelId]

export const antigravityProviderDefinition = createProviderDefinition({
	apiProvider: providerIdentifiers.antigravity,
	modelIdKey: API_MODEL_ID_FIELD,
	getModelId: createModelIdAccessor(API_MODEL_ID_FIELD),
	getDefaultModelId: () => antigravityDefaultModelId,
	schema: {
		...apiModelIdProviderModelShape,
		antigravityExecutablePath: z.string().optional(),
	},
})
