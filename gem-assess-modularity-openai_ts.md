# Modularity Assessment: `packages/types/src/providers/openai.ts`

**Date:** 2026-11-24  
**Target File:** [openai.ts](packages/types/src/providers/openai.ts) (`1,207` lines, `37,128` bytes)  
**Scope:** Analysis & modularization blueprint only (no code modified).

---

## 1. Current Architecture & Responsibilities

`packages/types/src/providers/openai.ts` mixes **two distinct providers** (`openai` OpenAI-Compatible and `openai-native`) plus **five unrelated concerns** in a single 1,207-line file:

1. **Webview/Host Message Contract (`13–19`):**
    - `openAiModelsMessageTypes`, `openAiModelsMessageTypeSchema`, `OpenAiModelsMessageType` (both `const` enum object and `type` via declaration merging).
2. **OpenAI-Native Model Catalog (`21–1054`, `1070` — ~86% of file):**
    - `OpenAiNativeModelId`, `OPENAI_API_PROTOCOL`, `openAiNativeDefaultModelId` (`"gpt-5.6-sol"`), `OPENAI_NATIVE_DEFAULT_TEMPERATURE` (`0`).
    - `gpt62NativeModelInfo` shared template + `openAiNativeModels` (26 model entries: GPT-6.2/6.1/6/5.6/5.5/5.4/5.3/5.2/5.1/5/4.1/4o, o1/o3/o4, `codex-mini-latest`, and dated snapshots).
3. **OpenAI-Compatible Defaults & Azure Endpoint Helpers (`1058–1115`):**
    - `openAiModelInfoSaneDefaults`, `azureOpenAiDefaultApiVersion`, `OPENAI_AZURE_AI_INFERENCE_PATH`.
    - `isAzureAiInferenceBaseUrl(baseUrl?)`, `isAzureOpenAiBaseUrl(baseUrl?, useAzure?)`.
    - `OPEN_AI_MODEL_ID_FIELD`, `DEFAULT_OPEN_AI_INCLUDE_MAX_TOKENS`, `DEFAULT_OPEN_AI_STRICT_TOOL_SCHEMAS`.
4. **`extra_body` JSON Parser & Prototype-Pollution Guard (`1117–1183`):**
    - `OPENAI_EXTRA_BODY_RESERVED_KEYS`, `OpenAiExtraBodyParseResult`, `parseOpenAiExtraBody()`, `openAiExtraBodySchema`.
5. **OpenAI-Compatible Provider Definition (`1185–1207`):**
    - `openAiProviderDefinition` (`createProviderDefinition({ apiProvider: providerIdentifiers.openai, ... })`).

### Key Structural Anomaly

- [openai-native.ts](packages/types/src/providers/openai-native.ts) (`26` lines) defines `openAiNativeProviderDefinition` and has to import `openAiNativeDefaultModelId` _from_ `openai.ts`, while the entire `openAiNativeModels` catalog (`1,030+` lines) lives inside `openai.ts` (the OpenAI-Compatible provider file).

---

## 2. Exact Dependency Map

### A. Package Export Boundary (`@roo-code/types`)

Per [packages/types/package.json](packages/types/package.json), `@roo-code/types` only exposes `.` ([src/index.ts](packages/types/src/index.ts)), `./model`, and `./provider-identifiers`—it does **not** expose `./providers/openai` as a public subpath.  
All external packages (`src/`, `webview-ui/`, `apps/`) import `openai.ts` symbols through `@roo-code/types` → [providers/index.ts](packages/types/src/providers/index.ts#L18) (`export * from "./openai.js"`).

### B. Direct File Imports (Inside `packages/types/` Only — 6 Files)

| File                                                                                               | Imported Symbols                                           | Impact if Modularized                                                                                                      |
| :------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| [providers/index.ts](packages/types/src/providers/index.ts#L18)                                    | `export * from "./openai.js"` + `openAiProviderDefinition` | **None** if `openai.ts` re-exports split modules or `index.ts` exports them.                                               |
| [providers/openai-native.ts](packages/types/src/providers/openai-native.ts#L11)                    | `openAiNativeDefaultModelId`                               | **Cleaner** if `openAiNativeModels` + `openAiNativeDefaultModelId` move to `openai-native-models.ts` / `openai-native.ts`. |
| [vscode-extension-host.ts](packages/types/src/vscode-extension-host.ts#L18)                        | `OpenAiModelsMessageType`                                  | **None** if re-exported from `openai.ts` (or updated to import from `openai-messages.ts`).                                 |
| [cache-write-ttl-pricing.test.ts](packages/types/src/__tests__/cache-write-ttl-pricing.test.ts#L7) | `openAiNativeModels`                                       | **None** if `openai.ts` re-exports, or 1-line import update.                                                               |
| [model-message-types.test.ts](packages/types/src/__tests__/model-message-types.test.ts#L6)         | `OpenAiModelsMessageType`, `openAiModelsMessageTypeSchema` | **None** if `openai.ts` re-exports, or 1-line import update.                                                               |
| [openai-models.test.ts](packages/types/src/__tests__/openai-models.test.ts#L2)                     | `openAiNativeDefaultModelId`, `openAiNativeModels`         | **None** if `openai.ts` re-exports, or 1-line import update.                                                               |

### C. Downstream Consumers (Via `@roo-code/types` — 36+ Files)

- **`packages/types/`:** `model.ts`, `provider-settings.ts`, `provider-settings.test.ts`.
- **`src/` (Extension Host):**
    - Providers: `openai.ts`, `openai-native.ts`, `base-openai-compatible-provider.ts`, `base-provider.ts`, `deepseek.ts`, `friendli.ts`, `lm-studio.ts`, `mistral.ts`, `native-ollama.ts`, `vscode-lm.ts`, `vscode-lm-capabilities.ts`, `retired-zoo-gateway.ts`, `fetchers/friendli.ts`
    - Core & Services: `webviewMessageHandler.ts`, `shared/cost.ts`, `services/code-index/embedders/openai.ts`
    - Tests: `openai.spec.ts`, `openai-native.spec.ts`, `openai-native-usage.spec.ts`, `base-openai-compatible-provider.spec.ts`, `friendli.spec.ts`, `github-copilot.spec.ts`, `vscode-lm.spec.ts`, `openai-compatible-responses.spec.ts`, `ProviderSettingsManager.spec.ts`, `ClineProvider.spec.ts`, `cost.spec.ts`
- **`webview-ui/`:** `OpenAI.tsx`, `OpenAICompatible.tsx`, `ApiOptions.tsx`, `ModelInfoView.tsx`, `useSelectedModel.ts`, `constants.ts`, `utils/validate.ts`, plus their specs and `playwright/roo-code-types.ts`.

---

## 3. Recommended Modularization Plan (Exact Steps)

Because external consumers only import from `@roo-code/types`, `openai.ts` can be split with **zero breaking changes** to `src/`, `webview-ui/`, or `apps/`:

1. **Step 1 — Move OpenAI-Native Catalog Out (`openai-native-models.ts` or into `openai-native.ts`):**
    - Extract `OpenAiNativeModelId`, `OPENAI_API_PROTOCOL`, `openAiNativeDefaultModelId`, `OPENAI_NATIVE_DEFAULT_TEMPERATURE`, and `openAiNativeModels` into `packages/types/src/providers/openai-native-models.ts` (and re-export from `openai-native.ts` and `providers/index.ts`).
    - Re-export them from `openai.ts` temporarily (or update the 3 internal test imports in `packages/types/src/__tests__/`).
2. **Step 2 — Deduplicate Model Family Templates inside `openAiNativeModels`:**
    - Currently, `gpt62NativeModelInfo` is factored out (lines 26–46), while `gpt-6.1-*`, `gpt-6-*`, `gpt-5.6-*`, `gpt-5.4-*`, `gpt-5-*` repeat `includedTools: ["apply_patch"]`, `excludedTools: ["apply_diff", "write_to_file"]`, `longContextPricing`, `supportsImages`, `supportsPromptCache`, `supportsTemperature: false`, and `tiers` shapes verbatim.
    - Extract shared family constants (e.g., `gptApplyPatchTools`, `gptLongContext272kPricing`) to shrink the catalog by ~250–300 lines without changing a single runtime value.
3. **Step 3 — Extract `extra_body` & Azure URL Helpers (`openai-compatible-helpers.ts`):**
    - Move `OPENAI_EXTRA_BODY_RESERVED_KEYS`, `OpenAiExtraBodyParseResult`, `parseOpenAiExtraBody()`, `openAiExtraBodySchema`, `isAzureAiInferenceBaseUrl()`, `isAzureOpenAiBaseUrl()`, `azureOpenAiDefaultApiVersion`, and `OPENAI_AZURE_AI_INFERENCE_PATH` into `openai-compatible-helpers.ts`.
4. **Step 4 — Keep `openai.ts` Focused on OpenAI-Compatible Provider Contract (`~60–80` lines):**
    - `openAiModelsMessageTypes` / `openAiModelsMessageTypeSchema` / `OpenAiModelsMessageType`
    - `openAiModelInfoSaneDefaults`, `OPEN_AI_MODEL_ID_FIELD`, `DEFAULT_OPEN_AI_INCLUDE_MAX_TOKENS`, `DEFAULT_OPEN_AI_STRICT_TOOL_SCHEMAS`
    - `openAiProviderDefinition`
    - Re-exports from `./openai-native-models.js` and `./openai-compatible-helpers.js` so no existing internal import breaks.

---

## 4. What Needs to Be Fixed, Patched, or Preserved

### Items to Fix / Clean Up

1. **Circular/Inverted Ownership:** `openai-native.ts` currently imports `openAiNativeDefaultModelId` from `openai.ts`. Moving `openAiNativeModels` + `openAiNativeDefaultModelId` to `openai-native-models.ts` makes `openai-native.ts` own its own catalog and removes `openai-native.ts`'s dependency on `openai.ts`.
2. **Duplicated Model-Entry Boilerplate:** Unify repeated `includedTools`/`excludedTools` and `longContextPricing` objects across `gpt-6.2`, `gpt-6.1`, `gpt-6`, `gpt-5.6`, `gpt-5.5`, `gpt-5.4`, `gpt-5` entries.
3. **Verify `openAiHostHeader` Deprecation Comment (`1203`):** Marked `"Keep temporarily for backward compatibility during migration"` — keep intact unless a separate migration PR removes it.

### Invariants That MUST Be Preserved (Do Not Break)

1. **Exact Barrel Exports in `@roo-code/types`:** Every exported symbol (`openAiNativeModels`, `openAiNativeDefaultModelId`, `OpenAiNativeModelId`, `openAiModelInfoSaneDefaults`, `OpenAiModelsMessageType`, `parseOpenAiExtraBody`, `isAzureAiInferenceBaseUrl`, `isAzureOpenAiBaseUrl`, `openAiProviderDefinition`, etc.) must remain exported at the package root (`packages/types/src/index.ts` → `providers/index.ts`).
2. **`as const satisfies Record<string, ModelInfo>` on `openAiNativeModels`:** Required so `OpenAiNativeModelId = keyof typeof openAiNativeModels` stays a literal union of model IDs rather than widening to `string`.
3. **Declaration Merging of `OpenAiModelsMessageType` (`17–19`):** Both the `const` object and the `type` share the name `OpenAiModelsMessageType`; [vscode-extension-host.ts](packages/types/src/vscode-extension-host.ts#L18) and [model-message-types.test.ts](packages/types/src/__tests__/model-message-types.test.ts#L6) rely on both value and type exports.
4. **Build Output (`tsup` CJS + ESM + `.d.cts`):** `packages/types` builds with `tsup` (`pnpm --filter @roo-code/types build`) and type-checks with ESM `.js` relative import extensions (`./...js`). All new internal relative imports in `packages/types/src/` must use `.js` extensions.

---

## 5. Other Files Impacted

- **Zero changes required in `src/`, `webview-ui/`, or `apps/`** (assuming `providers/index.ts` continues to re-export all symbols).
- **Optional 1-line import updates in `packages/types/`:**
    - [openai-native.ts](packages/types/src/providers/openai-native.ts#L11)
    - [cache-write-ttl-pricing.test.ts](packages/types/src/__tests__/cache-write-ttl-pricing.test.ts#L7)
    - [openai-models.test.ts](packages/types/src/__tests__/openai-models.test.ts#L2)
- **Verification commands after modularizing:**
    - `pnpm --filter @roo-code/types check-types`
    - `pnpm --filter @roo-code/types test`
    - `pnpm --filter @roo-code/types build`
    - `pnpm --dir src run check-types` (to confirm downstream `src/` + `webview-ui/` compatibility)
