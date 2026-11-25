import { z } from "zod"

import { type ModelInfo } from "../model.js"
import { providerIdentifiers } from "../provider-identifiers.js"
import {
	API_MODEL_ID_FIELD,
	apiModelIdProviderModelShape,
	createModelIdAccessor,
	createProviderDefinition,
} from "./common.js"

// Meta Muse Code runs through the locally installed, subscription-authenticated `muse` CLI.
// Catalog qualified with `muse exec --list-models` (Muse Code 1.4.25). The CLI does not publish
// context or output limits, so the limits below are conservative estimates. Zoo Code uses them
// to decide when to condense context. Users can enter any other model ID that the CLI accepts.

export const MUSE_CODE_DEFAULT_EXECUTABLE = "muse"

export const museCodeReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const

const museCodeBaseModelInfo = {
	maxTokens: 32_768,
	contextWindow: 200_000,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 0,
	outputPrice: 0,
	cacheReadsPrice: 0,
	cacheWritesPrice: 0,
	supportsReasoningEffort: [...museCodeReasoningEfforts],
	reasoningEffort: "high",
} as const satisfies ModelInfo

export const museCodeModels = {
	"muse-spark-1.3": {
		...museCodeBaseModelInfo,
		description: "Muse Spark 1.3 - Meta's general coding model, billed to your Muse Code subscription.",
	},
	"muse-wonder-1.0": {
		...museCodeBaseModelInfo,
		description:
			"Muse Wonder 1.0 - Meta's model for complex technical analysis, billed to your Muse Code subscription.",
	},
	"muse-ember-1.0": {
		...museCodeBaseModelInfo,
		description: "Muse Ember 1.0 - billed to your Muse Code subscription.",
	},
	"muse-spark-1.2": {
		...museCodeBaseModelInfo,
		description: "Muse Spark 1.2 - previous Spark release, billed to your Muse Code subscription.",
	},
} as const satisfies Record<string, ModelInfo>

export type MuseCodeModelId = keyof typeof museCodeModels

export const museCodeDefaultModelId: MuseCodeModelId = "muse-spark-1.3"

export const museCodeDefaultModelInfo: ModelInfo = museCodeModels[museCodeDefaultModelId]

export const museCodeProviderDefinition = createProviderDefinition({
	apiProvider: providerIdentifiers.museCode,
	modelIdKey: API_MODEL_ID_FIELD,
	getModelId: createModelIdAccessor(API_MODEL_ID_FIELD),
	getDefaultModelId: () => museCodeDefaultModelId,
	schema: {
		...apiModelIdProviderModelShape,
		museCodeExecutablePath: z.string().optional(),
		museCodeQuotaFallbackProfileId: z.string().min(1).optional(),
		museCodeQuotaFallbackAfterPartialReply: z.boolean().optional(),
	},
})
