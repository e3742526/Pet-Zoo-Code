import {
	MODEL_SELECTION_MAX_AGE_MONTHS,
	isModelHiddenFromSelection,
	modelInfoSchema,
	releaseDateFromUnixSeconds,
	type ModelInfo,
} from "../model.js"
import { anthropicDefaultModelId, anthropicModels } from "../providers/anthropic.js"
import { bedrockDefaultModelId, bedrockModels } from "../providers/bedrock.js"
import { fireworksModels } from "../providers/fireworks.js"
import { geminiModels } from "../providers/gemini.js"
import { moonshotModels } from "../providers/moonshot.js"
import { openAiNativeModels } from "../providers/openai-native-models.js"
import { sambaNovaDefaultModelId, sambaNovaModels } from "../providers/sambanova.js"
import { vertexDefaultModelId, vertexModels } from "../providers/vertex.js"
import { vscodeLlmModels } from "../providers/vscode-llm.js"
import { xaiModels } from "../providers/xai.js"
import { internationalZAiModels, mainlandZAiModels } from "../providers/zai.js"

// A fixed clock keeps these assertions stable as real time passes.
const NOW = new Date("2026-11-25T12:00:00Z")

const catalogs: Record<string, Record<string, ModelInfo>> = {
	anthropic: anthropicModels,
	bedrock: bedrockModels,
	fireworks: fireworksModels,
	gemini: geminiModels,
	moonshot: moonshotModels,
	openAiNative: openAiNativeModels,
	sambaNova: sambaNovaModels,
	vertex: vertexModels,
	vscodeLlm: vscodeLlmModels,
	xai: xaiModels,
	zaiInternational: internationalZAiModels,
	zaiMainland: mainlandZAiModels,
}

const hiddenIds = (models: Record<string, ModelInfo>) =>
	Object.entries(models)
		.filter(([, info]) => isModelHiddenFromSelection(info, NOW))
		.map(([id]) => id)

describe("isModelHiddenFromSelection", () => {
	it("uses a 24-month window", () => {
		expect(MODEL_SELECTION_MAX_AGE_MONTHS).toBe(24)
	})

	it.each([
		["one day before the cutoff", "2024-11-24", true],
		["on the cutoff", "2024-11-25", false],
		["inside the window", "2025-06-01", false],
		["in the future", "2027-01-01", false],
	])("handles a release date %s", (_label, releaseDate, hidden) => {
		expect(isModelHiddenFromSelection({ releaseDate }, NOW)).toBe(hidden)
	})

	it("keeps a model without a release date selectable", () => {
		expect(isModelHiddenFromSelection({}, NOW)).toBe(false)
	})

	it("keeps a model with an unparseable release date selectable", () => {
		expect(isModelHiddenFromSelection({ releaseDate: "2020-13-45" }, NOW)).toBe(false)
	})

	it("hides a deprecated model regardless of its release date", () => {
		expect(isModelHiddenFromSelection({ deprecated: true, releaseDate: "2026-11-01" }, NOW)).toBe(true)
	})
})

describe("releaseDateFromUnixSeconds", () => {
	it("formats Unix seconds as a UTC date", () => {
		expect(releaseDateFromUnixSeconds(1715558400)).toBe("2024-05-13")
	})

	it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])("returns undefined for %s", (value) => {
		expect(releaseDateFromUnixSeconds(value)).toBeUndefined()
	})
})

describe("static catalog release dates", () => {
	it.each(Object.entries(catalogs))("%s release dates pass the schema and parse", (_name, models) => {
		for (const [id, info] of Object.entries(models)) {
			if (info.releaseDate === undefined) continue
			expect(modelInfoSchema.shape.releaseDate.safeParse(info.releaseDate).success, id).toBe(true)
			expect(Number.isNaN(Date.parse(`${info.releaseDate}T00:00:00Z`)), id).toBe(false)
		}
	})

	it.each([
		[
			"anthropic",
			[
				"claude-3-5-sonnet-20241022",
				"claude-3-5-haiku-20241022",
				"claude-3-opus-20240229",
				"claude-3-haiku-20240307",
			],
		],
		["openAiNative", ["gpt-4o", "gpt-4o-mini", "o1-preview", "o1-mini"]],
		["sambaNova", ["Meta-Llama-3.1-8B-Instruct"]],
		["vertex", ["gemini-1.5-flash-002", "gemini-1.5-pro-002", "claude-3-5-sonnet@20240620"]],
		["vscodeLlm", ["gpt-4o-mini"]],
	])("%s hides models released more than two years ago", (name, ids) => {
		expect(hiddenIds(catalogs[name] ?? {})).toEqual(expect.arrayContaining(ids))
	})

	it("hides every Bedrock model released before the cutoff", () => {
		expect(hiddenIds(bedrockModels).sort()).toEqual(
			[
				"amazon.titan-text-express-v1:0",
				"amazon.titan-text-lite-v1:0",
				"anthropic.claude-3-5-haiku-20241022-v1:0",
				"anthropic.claude-3-5-sonnet-20240620-v1:0",
				"anthropic.claude-3-5-sonnet-20241022-v2:0",
				"anthropic.claude-3-haiku-20240307-v1:0",
				"anthropic.claude-3-opus-20240229-v1:0",
				"anthropic.claude-3-sonnet-20240229-v1:0",
				"meta.llama3-1-405b-instruct-v1:0",
				"meta.llama3-1-70b-instruct-latency-optimized-v1:0",
				"meta.llama3-1-70b-instruct-v1:0",
				"meta.llama3-1-8b-instruct-v1:0",
				"meta.llama3-2-11b-instruct-v1:0",
				"meta.llama3-2-1b-instruct-v1:0",
				"meta.llama3-2-3b-instruct-v1:0",
				"meta.llama3-2-90b-instruct-v1:0",
				"meta.llama3-70b-instruct-v1:0",
				"meta.llama3-8b-instruct-v1:0",
			].sort(),
		)
	})

	it("keeps models released inside the window selectable", () => {
		expect(isModelHiddenFromSelection(anthropicModels["claude-3-7-sonnet-20250219"], NOW)).toBe(false)
		expect(isModelHiddenFromSelection(bedrockModels["amazon.nova-pro-v1:0"], NOW)).toBe(false)
		expect(isModelHiddenFromSelection(openAiNativeModels["o1"], NOW)).toBe(false)
	})

	it.each([
		["anthropic", anthropicModels, anthropicDefaultModelId],
		["bedrock", bedrockModels, bedrockDefaultModelId],
		["sambaNova", sambaNovaModels, sambaNovaDefaultModelId],
		["vertex", vertexModels, vertexDefaultModelId],
	])("%s default model stays selectable", (_name, models, id) => {
		const info = (models as Record<string, ModelInfo>)[id]
		expect(info).toBeDefined()
		expect(isModelHiddenFromSelection(info ?? {}, NOW)).toBe(false)
	})
})
