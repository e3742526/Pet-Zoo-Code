# Modularity Assessment: `src/api/providers/vscode-lm.ts`

**Date:** 2026-11-24  
**Target File:** [vscode-lm.ts](src/api/providers/vscode-lm.ts) (`1,778` lines)  
**Scope:** Analysis & modularization blueprint only (no code modified).

---

## 1. Current Architecture & Responsibilities

`src/api/providers/vscode-lm.ts` is already cleanly typed (`0` entries in `src/eslint-suppressions.json`), but bundles **4 distinct subsystems** into one 1,778-line file:

1. **Tool & Message Helpers (`41–70`):**
    - `convertToVsCodeLmTools()` (OpenAI schema → `vscode.LanguageModelChatTool` via `normalizeToolSchema` + `sanitizeToolNameSurrogates`), `isChatMessage()`, `containsImageBlock()`.
2. **Leaked XML Tool-Call Recovery (`100–400`, `594–764` — ~470 lines):**
    - `QuotingScanState` (CommonMark fence/inline-code scanner + `<function_calls>` wrapper tracker), `stripTagsCompletely()`, `trailingPartialToolMarkerLength()`, `hasQuotingCue()`, `isQuotedAsCode()`, `declaredParamType()`, `convertLeakedParamValue()`, `parseLeakedInvokeParams()`, `extractLeakedToolCalls()`, `extractLeakedToolCallsWithState()`.
3. **Context-Window `tool_result` Budget & Middle-Out Truncation (`402–592` — ~190 lines):**
    - `middleOutTruncate()` (surrogate-safe), `estimateMessagesChars()`, `truncateToolResultsToFitWindow()`, `readToolResultText()`, `writeToolResultText()`, `trimTrailingHighSurrogate()`.
4. **`VsCodeLmHandler` & Model Discovery (`766–1778` — ~1,012 lines):**
    - Client lifecycle (`initializeClient`, `createClient`, `createFallbackClient`, `getClient`, `dispose`).
    - Subclass hooks (`deriveModelInfo`, `getFallbackModelInfo`, `supportsImageInput`, `assertRequestSupported`, `assertWithinContextWindow`, `prepareMessageForCounting`, `getCondenseContextWindow`, `getCompletionRequestOptions`).
    - Token counting (`countTokens`, `internalCountTokens`, `calculateTotalInputTokens`).
    - `createMessage()` (`1163–1583` — `420` lines): abort-token bridge, `deepClean` clone, `truncateToolResultsToFitWindow` guard, stream loop with leaked-tool-call salvage buffer, usage emission, and error normalization.
    - `completePrompt()` (`1652–1752`): single-shot completion with timeout + abort-token bridge.
    - `VSCODE_LM_STATIC_BLACKLIST` & `getVsCodeLmModels()` (`1755–1778`).

---

## 2. Exact Dependency Map

### A. Inbound Consumers

| File                                                                                                                                                                      | Imported Symbols                                                                                                                                                                                                                                             | Impact if Modularized                                                          |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| [src/api/index.ts](src/api/index.ts#L33) & [providers/index.ts](src/api/providers/index.ts#L26)                                                                           | `VsCodeLmHandler`                                                                                                                                                                                                                                            | **None** if `vscode-lm.ts` keeps exporting `VsCodeLmHandler`.                  |
| [github-copilot.ts](src/api/providers/github-copilot.ts#L11)                                                                                                              | `VSCODE_LM_STATIC_BLACKLIST`, `VsCodeLmHandler`, `containsImageBlock` (`GitHubCopilotHandler extends VsCodeLmHandler`)                                                                                                                                       | **None** if `vscode-lm.ts` keeps these exports and `protected` subclass hooks. |
| [webviewMessageHandler.ts](src/core/webview/webviewMessageHandler.ts#L84) & [webviewMessageHandler.spec.ts](src/core/webview/__tests__/webviewMessageHandler.spec.ts#L77) | `getVsCodeLmModels`                                                                                                                                                                                                                                          | **None** if `vscode-lm.ts` keeps exporting `getVsCodeLmModels`.                |
| [vscode-lm.spec.ts](src/api/providers/__tests__/vscode-lm.spec.ts#L117-L124) (`4,100+` lines)                                                                             | `VsCodeLmHandler`, `getVsCodeLmModels`, `VSCODE_LM_STATIC_BLACKLIST`, `containsImageBlock`, `trailingPartialToolMarkerLength`, `extractLeakedToolCalls`, `LeakedToolSchemas`, `middleOutTruncate`, `estimateMessagesChars`, `truncateToolResultsToFitWindow` | **None** if `vscode-lm.ts` re-exports the extracted `@internal` helpers.       |
| [src/api/**tests**/index.spec.ts](src/api/__tests__/index.spec.ts#L82)                                                                                                    | `VsCodeLmHandler`                                                                                                                                                                                                                                            | **None.**                                                                      |

### B. Outbound Dependencies

- **External:** `vscode`, `@anthropic-ai/sdk` (types only), `openai` (types only).
- **Internal:** `@roo-code/types`, `BaseProvider`, `getVsCodeLmModelInfo` ([vscode-lm-capabilities.ts](src/api/providers/vscode-lm-capabilities.ts)), `../transform/vscode-lm-format`, `../transform/stream`, `./utils/abort-signal`, `../../utils/json-schema`, `../../shared/vsCodeSelectorUtils`, `CONTEXT_WINDOW_EXCEEDED_STATUS`.

---

## 3. Recommended Modularization Plan (Exact Steps)

Split `src/api/providers/vscode-lm.ts` into 3–4 focused modules while keeping `vscode-lm.ts` as the public entry point + re-export facade (`~650` lines):

1. **Step 1 — Extract Leaked Tool-Call Recovery (`vscode-lm-leaked-tools.ts`):**
    - Move `QuotingScanState`, `LEAKED_TOOL_CALL_START`, `MAX_PARTIAL_INVOKE_CARRY`, `trailingPartialToolMarkerLength`, `extractLeakedToolCalls`, `extractLeakedToolCallsWithState`, `LeakedToolSchemas`, `parseLeakedInvokeParams`, `convertLeakedParamValue`, `declaredParamType`, `structuredParamCheck`, `resolveTypeUnion`, `stripTagsCompletely`, `isQuotedAsCode`, `hasQuotingCue`, plus a small `LeakedToolSalvageBuffer` class encapsulating the streaming buffer/carry state (`1231–1282`, `1403–1441`).
    - Re-export `trailingPartialToolMarkerLength`, `extractLeakedToolCalls`, and `LeakedToolSchemas` from `vscode-lm.ts` for `vscode-lm.spec.ts`.
2. **Step 2 — Extract Context-Window Truncation (`vscode-lm-context-budget.ts`):**
    - Move `VSCODE_LM_BUDGET_CHARS_PER_TOKEN`, `VSCODE_LM_INPUT_BUDGET_FRACTION`, `MIN_TOOL_RESULT_CHARS`, `IMAGE_PLACEHOLDER_CHARS`, `middleOutTruncate`, `estimateMessagesChars`, `truncateToolResultsToFitWindow`, and their private helpers.
    - Re-export `middleOutTruncate`, `estimateMessagesChars`, and `truncateToolResultsToFitWindow` from `vscode-lm.ts`.
3. **Step 3 — Extract Abort-Token Bridge Helper (`vscode-lm-abort.ts` or method on `VsCodeLmHandler`):**
    - `createMessage()` (`1175–1200`, `1561–1582`) and `completePrompt()` (`1658–1751`) both bridge `AbortSignal` → `vscode.CancellationTokenSource` with `{ once: true }` + `removeEventListener` cleanup. Extract a shared `createCancellationBridge(externalSignal?, timeoutMs?)` helper.
4. **Step 4 — Keep `VsCodeLmHandler` + `getVsCodeLmModels` in `vscode-lm.ts`:**
    - `createMessage()` shrinks from 420 lines to ~150 lines by delegating to `LeakedToolSalvageBuffer`, `truncateToolResultsToFitWindow`, and `createCancellationBridge`.

---

## 4. What Needs to Be Fixed, Patched, or Preserved

### Code-Quality & Hygiene Notes

1. **Zero ESLint Suppressions:** `vscode-lm.ts` currently has **0** entries in `src/eslint-suppressions.json`. Keep any new files at **0** `any`s and **0** suppressions (`pnpm --dir src exec eslint --prune-suppressions --max-warnings=0`).
2. **Do NOT Remove `deepClean` (`1139–1161`) Thinking It Is a No-Op:**
    - `cleanMessageContent` / `deepClean` recursively clones `msg.content` so `truncateToolResultsToFitWindow` (which mutates `tool_result` blocks in place) never mutates stored task history. If refactoring, rename it to `cloneMessageContent` so its purpose is obvious.
3. **Preserve `releaseRequestCancellation` (`1102–1108`) & All `protected` Hooks:**
    - [github-copilot.ts](src/api/providers/github-copilot.ts) subclasses `VsCodeLmHandler` and overrides 10 `protected` / `override` methods (`createFallbackClient`, `deriveModelInfo`, `getFallbackModelInfo`, `getCompletionRequestOptions`, `supportsImageInput`, `prepareMessageForCounting`, `assertRequestSupported`, `assertWithinContextWindow`, `getCondenseContextWindow`, `countTokens`).
4. **Preserve Error & Abort Contracts:**
    - Keep `CONTEXT_WINDOW_EXCEEDED_STATUS` on the budget-exceeded error (`1348`) so `Task` triggers auto-condense instead of retrying.
    - Keep `createAbortError(this.providerName)` on all cancellation paths (`externalAbortSignal`, `cancellationTokenSource`, `vscode.CancellationError`), including after `internalCountTokens` (`1508–1514`).
    - Keep `VSCODE_LM_STATIC_BLACKLIST` and `getVsCodeLmModels()` exported from `vscode-lm.ts`.

---

## 5. Other Files Impacted

- **Zero changes required in [github-copilot.ts](src/api/providers/github-copilot.ts), [webviewMessageHandler.ts](src/core/webview/webviewMessageHandler.ts), or [src/api/index.ts](src/api/index.ts)** if `vscode-lm.ts` retains its exports.
- **Note on [packages/config-eslint/api-provider-hygiene.js](packages/config-eslint/api-provider-hygiene.js#L90):** `vscode-lm.spec.ts` is exempted there, not `vscode-lm.ts`.
- **Required verification after modularization:**
    - `pnpm --dir src run check-types`
    - `pnpm --dir src exec vitest run src/api/providers/__tests__/vscode-lm.spec.ts src/api/providers/__tests__/github-copilot.spec.ts src/api/__tests__/index.spec.ts`
    - `pnpm --dir src exec eslint --prune-suppressions --max-warnings=0 api/providers/vscode-lm.ts` (and any new files under `api/providers/`)
