# Modularity Assessment: `src/core/assistant-message/presentAssistantMessage.ts`

**Date:** 2026-11-24  
**Target File:** [presentAssistantMessage.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/assistant-message/presentAssistantMessage.ts) (`1,220` lines, `45,432` bytes)  
**Scope:** Analysis & modularization blueprint only (no code modified).

---

## 1. Current Architecture & Responsibilities

`presentAssistantMessage.ts` is the central streaming block presenter and tool-execution dispatcher (`1,220` lines). Nearly the entire file lives inside one `1,075`-line function (`presentAssistantMessageBlock`, lines `128–1203`), which mixes **6 distinct responsibilities**:

1. **Serial Dispatch Lock & Block Cursor (`92–163`, `1167–1203`):**
    - `presentAssistantMessage()` manages `DispatchState.IDLE` ↔ `SERIAL`, `pendingWork` drain loop, and `finally` unlock.
    - `presentAssistantMessageBlock()` shallow-clones `assistantMessageContent[currentStreamingContentIndex]`, advances `currentStreamingContentIndex++`, sets `userMessageContentReady`, and recurses when more blocks are buffered.
2. **Duplicated Tool-Call Context Builders (`190–320` vs `608–760`):**
    - `pushToolResult`, `askApproval` (with `autoDenyDetail`, `user_feedback`, `approvalFeedback`, `markToolRejected`), and `handleError` (`AskIgnoredError` + `serializeError`) are implemented **twice**—once in `case "mcp_tool_use"` and once in `case "tool_use"`.
3. **Policy Validation & Telemetry Recording (`55–73`, `371–426`, `766–835`):**
    - `toTelemetryToolName()`, frozen `policySnapshot` validation via `buildToolRequirements()` + `validateToolUse()`, dynamic `import("../prompts/tools/filter-tools-for-mode")`, and single-point `recordToolUsage` / `TelemetryService.instance.captureToolUsage`.
4. **Tool Repetition Guard (`837–893`):**
    - `toolRepetitionDetector.check(block)` soft-block / hard-block handling.
5. **Tool Description Formatter & 22-Tool Dispatch Table (`489–551`, `895–1089`):**
    - `toolDescription()` `switch (block.name)` (24 cases) and execution `switch (block.name)` (22 cases + `checkpointSaveAndMark` on 8 mutating tools).
6. **Custom Tool & Unknown Tool Fallback (`1090–1155`):**
    - `customToolRegistry.get(block.name)` Zod parse + execute + error reporting, and unknown-tool `tool_result` emission.

---

## 2. Exact Dependency Map

### A. Inbound Consumers

| File                                                                                                                                                                                                                                                            | Usage                                                                                     | Impact if Modularized                                                 |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| [Task.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task/Task.ts)                                                                                                                                                                                    | Calls `presentAssistantMessage(this, policySnapshot)` via `presentAssistantMessageSafe()` | **None** if `presentAssistantMessage` signature & export stay intact. |
| [index.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/assistant-message/index.ts)                                                                                                                                                                     | Barrel re-export                                                                          | **None.**                                                             |
| **12+ Test Suites:** `presentAssistantMessage-*.spec.ts` (auto-deny, custom-tool, images, tool-usage-attribution, unknown-tool, etc.), `ToolExecutionContext.spec.ts`, `Task.spec.ts` (spies on `presentAssistantMessage`), `Task.streaming-tool-calls.spec.ts` | Import `presentAssistantMessage` and/or `toTelemetryToolName`                             | **None** if both exports stay in `presentAssistantMessage.ts`.        |
| [scripts/check-tool-turn-continuation.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/scripts/check-tool-turn-continuation.ts#L132)                                                                                                                             | Models `DispatchState` / `pendingWork` lock semantics                                     | **None** (preserve lock semantics).                                   |

### B. Outbound Dependencies

- **All 22 Tool Singletons** (`../tools/*Tool.ts`), `validateToolUse`, `isValidToolName`, `buildToolRequirements`, `resolveToolAlias` (dynamic import).
- **Task & Context:** `Task`, `DispatchState` / `transitionDispatch`, `markToolRejected`, `AskIgnoredError`, `buildAutoDenyReason`, `formatResponse`.
- **External & Shared:** `@anthropic-ai/sdk`, `serialize-error`, `@roo-code/types`, `TelemetryService`, `customToolRegistry`, `sanitizeToolUseId`, `resolveMcpToolByName` / `isMcpToolAlias`, `t`.

### C. Lint & Suppressions

- [src/eslint.config.mjs](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/eslint.config.mjs#L81): Disables `"no-case-declarations": "off"` for `presentAssistantMessage.ts`.
- [src/eslint-suppressions.json](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/eslint-suppressions.json#L462): `3` `@typescript-eslint/no-explicit-any` suppressions (`let block: any` at line 149, `(block as any).id` at line 464, `catch (executionError: any)` at line 1131).

---

## 3. Recommended Modularization Plan (Exact Steps)

Keep `presentAssistantMessage()` and `toTelemetryToolName()` in `src/core/assistant-message/presentAssistantMessage.ts` (`~180–220` lines), and extract 4 cohesive modules under `src/core/assistant-message/`:

1. **Step 1 — Extract Shared Tool Execution Callbacks (`toolCallCallbacks.ts`):**
    - Unify the duplicated `pushToolResult`, `askApproval`, `handleError`, and `askFinishSubTaskApproval` factories currently copied between `mcp_tool_use` and `tool_use`.
    - Also unifies the missing `queuedMessageId` handling in `mcp_tool_use`!
2. **Step 2 — Extract Policy Validation & Repetition Guard (`toolCallValidation.ts`):**
    - Extract `validateToolPolicy()` (the shared `buildToolRequirements` + `resolveToolAlias` + `validateToolUse` + error `tool_result` emitter used by both `mcp_tool_use` and `tool_use`) and `checkToolRepetition()`.
3. **Step 3 — Extract Tool Registry / Dispatch Table & Descriptions (`toolDispatch.ts`):**
    - Replace the 24-case `toolDescription()` switch and 22-case `switch (block.name)` (`895–1089`) with a typed dispatch map/table + `checkpointSaveAndMark` flag (`needsCheckpoint: true` for the 8 mutating/task tools), plus `executeCustomOrUnknownTool()`.
4. **Step 4 — Extract `mcp_tool_use` Adapter (`presentMcpToolUse.ts`):**
    - Move MCP tool-name resolution (`resolveMcpToolByName`, `MAX_MCP_TOOL_NAME_LENGTH`) and `syntheticToolUse` construction into a dedicated helper.

---

## 4. What Needs to Be Fixed, Patched, or Preserved

### Bugs & Code-Quality Issues to Fix During Modularization

1. **Eliminate the 3 `any`s & `no-case-declarations` Exemption:**
    - Replace `let block: any` (`149`) with `AssistantMessageContent` (the typed union from `AssistantMessageParser` / `NativeToolCallParser`).
    - Replace `(block as any).id` (`464`) with proper narrowing on `ToolUse` / `McpToolUse`.
    - Replace `catch (executionError: any)` (`1131`) with `catch (executionError: unknown)` + `error instanceof Error ? error.message : String(executionError)`.
    - Run `pnpm --dir src exec eslint --prune-suppressions --max-warnings=0 core/assistant-message/presentAssistantMessage.ts` to drop the count from `3` to `0`, and ensure new files have `0` `any`s.
2. **Fix `queuedMessageId` Gap in `mcp_tool_use` (`264–305` vs `676–734`):**
    - `tool_use`'s `askApproval` calls `cline.persistQueuedFeedbackAndAcknowledge(queuedMessageId, text, images)`, while `mcp_tool_use`'s duplicate `askApproval` omits `queuedMessageId`. Unifying `askApproval` fixes this automatically.
3. **Check Circular Import Reason for `await import("../prompts/tools/filter-tools-for-mode")` (`382`, `770`):**
    - Verify whether `resolveToolAlias` can be a static import (or move `resolveToolAlias` to a cycle-free module) instead of dynamically importing it on every completed tool call.

### Invariants That MUST Be Preserved (Do Not Break)

1. **Frozen `policySnapshot` Guard (`101–105`):**
    - Error message `[presentAssistantMessage] task ${cline.taskId}.${cline.instanceId} missing request policy snapshot` must NOT end in `"aborted"` (see comment at line 99).
2. **Shallow Block Copy (`155`):**
    - Keep `{ ...cline.assistantMessageContent[cline.currentStreamingContentIndex] }` (not deep clone) for streaming performance.
3. **`DispatchState` Lock & Drain Loop (`107–125`, `1167–1197`):**
    - Preserve exact ordering of `cline.pendingWork = null`, `currentStreamingContentIndex++`, `userMessageContentReady = true`, and `finally { cline.dispatchState = DispatchState.IDLE }`.
4. **Native `tool_use_id` 1:1 `tool_result` Guarantee:**
    - Every complete `tool_use` / `mcp_tool_use` (even on `didRejectTool`, missing `nativeArgs`, validation error, or unknown tool) must emit **at most one** `tool_result` without setting `didAlreadyUseTool = true` on validation/unknown-tool errors.
5. **Single-Point Telemetry (`818–834`) & `toTelemetryToolName` Export (`55–73`):**
    - Usage is recorded once centrally before tool execution; never record raw model-supplied tool names in telemetry.

---

## 5. Other Files Impacted

- **Zero changes required in [Task.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task/Task.ts) or any of the 22 tool handlers** if `presentAssistantMessage` and `toTelemetryToolName` keep their signatures and exports.
- **Required verification after modularization:**
    - `pnpm --dir src run check-types`
    - `pnpm --dir src exec vitest run src/core/assistant-message/__tests__/ src/core/task/__tests__/ToolExecutionContext.spec.ts src/core/task/__tests__/Task.streaming-tool-calls.spec.ts`
    - `pnpm --dir src exec eslint --prune-suppressions --max-warnings=0 core/assistant-message/presentAssistantMessage.ts`
