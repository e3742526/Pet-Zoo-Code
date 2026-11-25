// Azure endpoint classification and extra request body validation, with public helpers re-exported by openai.ts.
// Extracted from providers/openai.ts.

import { z } from "zod"

// https://learn.microsoft.com/en-us/azure/ai-services/openai/api-version-deprecation
// https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#api-specs
export const azureOpenAiDefaultApiVersion = "2024-08-01-preview"

export const OPENAI_AZURE_AI_INFERENCE_PATH = "/models/chat/completions"

/**
 * Returns true when the base URL belongs to Azure AI Inference.
 * These endpoints use the regular OpenAI client and expect a model identifier,
 * even when the Azure compatibility flag is enabled.
 */
export function isAzureAiInferenceBaseUrl(baseUrl?: string): boolean {
	try {
		const host = new URL(baseUrl ?? "").host
		return host.endsWith(".services.ai.azure.com")
	} catch {
		return false
	}
}

/**
 * Returns true when the base URL and/or flag indicate an Azure OpenAI endpoint.
 * Azure AI Inference endpoints (*.services.ai.azure.com) return false — the
 * backend routes those through the plain OpenAI client, not AzureOpenAI.
 */
export function isAzureOpenAiBaseUrl(baseUrl?: string, useAzure?: boolean): boolean {
	if (isAzureAiInferenceBaseUrl(baseUrl)) return false
	if (useAzure) return true

	try {
		const host = new URL(baseUrl ?? "").host
		return host === "azure.com" || host.endsWith(".azure.com")
	} catch {
		return false
	}
}

const OPENAI_EXTRA_BODY_RESERVED_KEYS = [
	// Prototype-pollution defenses; remaining keys are request-owned, including tool-call protocol controls.
	"__proto__",
	"constructor",
	"prototype",
	"max_completion_tokens",
	"max_tokens",
	"messages",
	"model",
	"parallel_tool_calls",
	"reasoning",
	"reasoning_effort",
	"response_format",
	"stream",
	"stream_options",
	"temperature",
	"tool_choice",
	"tools",
] as const

type OpenAiExtraBodyParseResult =
	| { success: true; data: Record<string, unknown> }
	| {
			success: false
			reason: "invalidJson" | "objectRequired" | "reservedKeys"
			data: Record<string, unknown>
			reservedKeys?: string[]
	  }

export function parseOpenAiExtraBody(value: string | undefined): OpenAiExtraBodyParseResult {
	if (!value?.trim()) {
		return { success: true, data: {} }
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(value)
	} catch {
		return { success: false, reason: "invalidJson", data: {} }
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { success: false, reason: "objectRequired", data: {} }
	}

	const entries = Object.entries(parsed)
	const reservedKeys = entries
		.map(([key]) => key)
		.filter((key) => (OPENAI_EXTRA_BODY_RESERVED_KEYS as readonly string[]).includes(key))
	const data = Object.fromEntries(entries.filter(([key]) => !reservedKeys.includes(key)))

	if (reservedKeys.length > 0) {
		return { success: false, reason: "reservedKeys", reservedKeys, data }
	}

	return { success: true, data }
}

export const openAiExtraBodySchema = z
	.string()
	.superRefine((value, ctx) => {
		const result = parseOpenAiExtraBody(value)
		if (!result.success) {
			ctx.addIssue({ code: "custom", message: result.reason })
		}
	})
	.optional()
