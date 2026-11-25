# Modularity Assessment: `webview-ui/src/components/chat/ChatRow.tsx`

**Date:** 2026-11-24  
**Target File:** [ChatRow.tsx](file:///Users/eric/Work/vscode/Pet-Zoo-Code/webview-ui/src/components/chat/ChatRow.tsx) (`1,824` lines, `59,780` bytes)  
**Scope:** Analysis & modularization blueprint only (no code modified).

---

## 1. Current Architecture & Responsibilities

`ChatRow.tsx` is the central message-row renderer for the chat timeline (`1,824` lines). It exports **two** components (`default ChatRow` and named `ChatRowContent`) and currently handles **6 distinct layers**:

1. **Row Shell & Auto-Scroll Height Observer (`156–188`):**
    - `ChatRow` (`React.memo(..., deepEqual)`) wraps `ChatRowContent` and attaches a `ResizeObserver` when `isLast` is true to notify `ChatView` via `onHeightChange`.
2. **Context Isolation & Transcript Wrapper (`190–275`):**
    - `ChatRowContent` reads the narrow `useExtensionChatRowState()` context (`ExtensionChatRowContext` in [ExtensionStateContext.tsx](file:///Users/eric/Work/vscode/Pet-Zoo-Code/webview-ui/src/context/ExtensionStateContext.tsx#L187-L193)) and only mounts `ChatRowWithTranscript` (which reads full `useExtensionState().clineMessages`) for `subtask_result`, `newTask`, or `updateTodoList`.
    - `EditChatTextArea` subscribes to `useExtensionState()` + `window` `"selectedImages"` messages only while editing a `user_feedback` row.
3. **Header Icon & Title Computation (`377–495`):**
    - `useMemo` returning `[icon, title]` tuple for `command`, `use_mcp_server`, `completion_result`, `api_req_started`, `followup`, etc.
4. **Tool-Use Ask/Say Renderer (`527–1093` — `566` lines):**
    - Giant `switch (tool.tool as string)` covering: file-edit diffs (`editedExistingFile`, `appliedDiff`, `newFileCreated`, `apply_patch`, `apply_diff`, etc. + `BatchDiffApproval`), `insertContent`, `codebaseSearch`, `updateTodoList`, `readFile` (single + `BatchFilePermission`), `skill`, `listFilesTopLevel`, `listFilesRecursive`, `searchFiles`, `switchMode`, `newTask`, `finishTask`, `runSlashCommand`, and `generateImage`.
5. **`say` Message Renderer (`1096–1698` — `602` lines):**
    - `diff_error`, `subtask_result`, `reasoning`, `api_req_started`, `api_req_retry_delayed`, `api_req_rate_limit_wait`, `text`, `user_feedback` (with inline `EditChatTextArea` + delete), `user_feedback_diff`, `error`, `completion_result`, `shell_integration_warning`, `checkpoint_saved`, `condense_context*`, `sliding_window_truncation`, `codebase_search_result`, `user_edit_todos`, `tool` (`runSlashCommand`, `readCommandOutput`), `image`, `too_many_tools_warning`, `ignored_disabled_tools_warning`, and default `Markdown`.
6. **`ask` Message Renderer (`1699–1823`):**
    - `mistake_limit_reached`, `command` (`CommandExecution`), `use_mcp_server` (`McpResourceRow` / `McpExecution`), `completion_result`, `followup` (`FollowUpSuggest`), `auto_approval_max_req_reached`.

---

## 2. Exact Dependency Map

### A. Inbound Consumers (Who Imports `ChatRow` or `ChatRowContent`)

| File                                                                                                                           | Import                                                                                  | Impact if Modularized                                              |
| :----------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| [ChatView.tsx](file:///Users/eric/Work/vscode/Pet-Zoo-Code/webview-ui/src/components/chat/ChatView.tsx)                        | Default `ChatRow`                                                                       | **None** if `ChatRow.tsx` keeps default export + `ChatRowProps`.   |
| **9 `ChatView.*.spec.tsx` tests**                                                                                              | `vi.mock("../ChatRow", ...)`                                                            | **None** if path & default export are preserved.                   |
| **8 `ChatRow.*.spec.tsx` + `IgnoredDisabledToolsNotice.spec.tsx` + `MessageTimestamps.visual.fixture.tsx`**                    | Named `ChatRowContent` (and `ChatRow` in `ChatRow.timestamp.spec.tsx`)                  | **None** if `ChatRow.tsx` keeps `export const ChatRowContent`.     |
| [stories.tsx](file:///Users/eric/Work/vscode/Pet-Zoo-Code/webview-ui/playwright/gallery/stories.tsx)                           | Gallery stories (uses `MessageTimestamps.visual.fixture.tsx` / `ChatRow`)               | **None** if exports are preserved.                                 |
| [ExtensionStateContext.tsx](file:///Users/eric/Work/vscode/Pet-Zoo-Code/webview-ui/src/context/ExtensionStateContext.tsx#L187) | Defines `ExtensionChatRowState` + `useExtensionChatRowState` specifically for `ChatRow` | **None** (keep `ChatRowContent` using `useExtensionChatRowState`). |

### B. Backend Coupling (Implicit String Contracts)

- [Task.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task/Task.ts#L6198-L6199): Formats `api_req_retry_delayed` as `"<status>\n<message>"` and `<retry_timer>N</retry_timer>` specifically for `ChatRow` parsing (lines 1188–1203).
- [error-handler.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/api/providers/utils/error-handler.ts#L112): Emits error fields consumed by `ChatRow` / `ErrorRow`.

### C. ESLint Config Coupling

- [webview-ui/eslint.config.mjs](file:///Users/eric/Work/vscode/Pet-Zoo-Code/webview-ui/eslint.config.mjs#L50-L65) has **two file-specific rule exemptions** for `src/components/chat/ChatRow.tsx`:
    - `"react/jsx-key": "off"` (lines 50–54)
    - `"no-case-declarations": "off"` (lines 56–65)

---

## 3. Recommended Modularization Plan (Exact Steps)

Keep `ChatRow.tsx` as the thin entry point (`~180–220` lines) exporting `default ChatRow` and `ChatRowContent`, and extract by message category:

1. **Step 1 — Extract Pure Message Helpers (`chatRowHelpers.ts`):**
    - Move `ChatRowTool`, `findPreviousTodoUpdate()`, `isNewTaskMessage()`, `getLinkedChildTaskId()`, and `formatBytes()`.
2. **Step 2 — Extract Header Icon/Title Builder (`useChatRowHeader.tsx` or `getChatRowHeader.tsx`):**
    - Move the `useMemo` header logic (`377–495`) and return `{ icon, title }` (an object, **not** a `[icon, title]` array) so `react/jsx-key` passes cleanly.
3. **Step 3 — Extract Tool-Use Row Renderer (`ChatToolRow.tsx`):**
    - Move the `switch (tool.tool)` block (`527–1093`) into `ChatToolRow.tsx`.
    - Extract a shared `ExpandableCardRow` (or `SkillOrCommandCard`) for the duplicated `skill` (`730–798`) and `runSlashCommand` (`983–1053` & `1509–1578`) cards.
4. **Step 4 — Extract User Message & Edit Bubble (`UserFeedbackRow.tsx`):**
    - Move `EditChatTextArea` (`194–211`) and `case "user_feedback"` (`1283–1369`) into `UserFeedbackRow.tsx`.
5. **Step 5 — Extract API Request & Retry/Rate-Limit Rows (`ApiRequestRow.tsx`):**
    - Move `api_req_started` (`1138–1182`), `api_req_retry_delayed` (`1183–1223`), and `api_req_rate_limit_wait` (`1224–1252`).
6. **Step 6 — Extract Remaining `say` & `ask` Sub-Renderers (`ChatSayRow.tsx`, `ChatAskRow.tsx`):**
    - Route `say` (`text`, `completion_result`, `subtask_result`, `codebase_search_result`, `too_many_tools_warning`, `ignored_disabled_tools_warning`, etc.) and `ask` (`command`, `use_mcp_server`, `completion_result`, `followup`, etc.) cleanly.

---

## 4. What Needs to Be Fixed, Patched, or Preserved

### Bugs & Code-Quality Issues to Fix During Modularization

1. **ESLint Exemptions in [webview-ui/eslint.config.mjs](file:///Users/eric/Work/vscode/Pet-Zoo-Code/webview-ui/eslint.config.mjs#L50-L65):**
    - Any newly created `.tsx` files will **not** inherit `ChatRow.tsx`'s `"react/jsx-key": "off"` or `"no-case-declarations": "off"` overrides.
    - Fix all unbraced `case` variable declarations (`{ ... }`) and return `{ icon, title }` objects instead of `[icon, title]` arrays, then remove `ChatRow.tsx` from those two ESLint override lists too.
2. **Eliminate `as any` & Empty-Object Disable:**
    - Line 153: `// eslint-disable-next-line @typescript-eslint/no-empty-object-type` on `ChatRowContentProps` → use `type ChatRowContentProps = Omit<ChatRowProps, "onHeightChange">`.
    - Line 1503: `case "tool" as any:` → type `ClineSay` or handle via a typed helper/guard.
    - Line 1715: `safeJsonParse<any>(message.text, {})` → use `safeJsonParse<Record<string, unknown>>` or `ClineAskUseMcpServer`.
3. **Deduplicate `skill` & `runSlashCommand` Card Markup (3 Copies):**
    - Lines `730–798`, `983–1053`, and `1509–1578` duplicate the same bordered expandable card + `VSCodeBadge` + chevron toggle. Extract one shared component.
4. **Deduplicate `say` vs `ask` `completion_result` (`1414–1436` vs `1772–1792`):**
    - Extract a shared `CompletionResultRow` component (also check whether `ask: "completion_result"` intentionally omits `MessageTimestamp`).

### Invariants That MUST Be Preserved (Do Not Break)

1. **Context Isolation (`useExtensionChatRowState` vs `useExtensionState`):**
    - Never move `useExtensionState()` into `ChatRow` or `ChatRowContent` directly—only `ChatRowWithTranscript` (3 rare message types) and `EditChatTextArea` (active edit mode) may subscribe to `useExtensionState()`. Breaking this causes every row in the chat list to re-render on every streaming token!
2. **`memo(ChatRow, deepEqual)` & `ResizeObserver` Height Callback (`156–186`):**
    - Preserve `deepEqual` memoization and the `before > 0` guard on `onHeightChange(height > before)` so Virtuoso auto-scroll does not jump on initial mount.
3. **Exports (`default ChatRow` and `export const ChatRowContent`):**
    - Required by `ChatView.tsx`, 9 `ChatView.*.spec.tsx` mocks, and 10 `ChatRowContent` test/fixture consumers.

---

## 5. Other Files Impacted

- **Zero changes required in `src/` or `ChatView.tsx`** (unless you also clean up the `ChatRow.tsx` entries in [webview-ui/eslint.config.mjs](file:///Users/eric/Work/vscode/Pet-Zoo-Code/webview-ui/eslint.config.mjs#L50-L65)).
- **Required verification after modularization:**
    - `pnpm --dir webview-ui check-types`
    - `pnpm --dir webview-ui lint`
    - `pnpm --dir webview-ui exec vitest run src/components/chat/__tests__/ChatRow*.spec.tsx src/components/chat/__tests__/IgnoredDisabledToolsNotice.spec.tsx src/components/chat/__tests__/ChatView.spec.tsx`
