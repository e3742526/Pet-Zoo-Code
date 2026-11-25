# Codebase Optimization, Performance & Dead-Code Audit Report

**Date**: 24 November 2026  
**Repository**: `Pet-Zoo-Code` (`roo-code` monorepo)  
**Branch**: `refactor/standalone-independence` (audited against current working tree, read-only — no source files modified)

---

## Executive Summary

This report documents verified optimization opportunities, runtime performance bottlenecks, bundle/VSIX bloat, zombie packages, dead code, and redundant abstractions across the extension host (`src/`), webview UI (`webview-ui/`), shared packages (`packages/`), apps (`apps/`), build scripts, and test/lint tooling.

### Key Highlights

- **Extension Host Startup & Hot Paths**: Startup synchronously loads all 18 i18n languages (126 JSON files / 836 KB), eagerly bundles 2.2 MB of `tiktoken` BPE tables in the main thread despite worker execution, and issues 36 Keychain `SecretStorage` reads. At runtime, every webview state broadcast triggers 2 sequential OAuth `SecretStorage` IPC calls (no negative cache), `webviewMessageHandler.ts` calls full `postStateToWebview()` 38 times (resending full `taskHistory` + `clineMessages`), and `web-tree-sitter` leaks WASM heap memory on every parsed file because `.delete()` is never called.
- **Webview UI Rendering & Bundle**: Shiki eagerly loads all ~60+ `bundledThemes` at boot when only 4 are used; `webviewDidLaunch` fires twice on mount; `HistoryView` passes an inline `React.forwardRef` into Virtuoso causing full list unmount/remount on every render; every mounted `ChatRow` mounts a hidden `<iframe>` (`useSize`), subscribes to 6 React Query hooks (`useSelectedModel`), and attaches a global `window` message listener; and `CodeBlock` triggers N× synchronous forced reflows on every scroll event.
- **VSIX & Build Diet**: Over **25 MB uncompressed** can be shed from the VSIX by dropping 7 unused `tree-sitter-wasms` binaries (10.17 MB, led by 7.53 MB `tree-sitter-objc.wasm`), deduplicating `assets/marketplace` and `tiktoken_bg.wasm` (2× 1.0 MB), gating production sourcemaps, and reconsidering the 13 MB `esbuild-wasm` binary.
- **Zombie & Dead Code**: `@roo-code/cloud` (2,887 LOC) is 100% uninitialized at runtime (`CloudService.createInstance` has 0 callers), `@roo-code/telemetry` is a no-op shell with 0 registered clients, the entire `textMateToHljs` theme pipeline is dead, `src/utils/logging/index.ts` has an inverted `NODE_ENV === "test"` check that silences production logs while doing sync file writes in tests, and `knip.json` masks 4 test-only zombie files in `src/`.

### Top 12 Highest-ROI Quick Wins

| Rank | ID          | Area             | Opportunity                                                                                                       | Impact   | Effort |
| ---- | ----------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| 1    | **W14**     | Webview Bundle   | Load only the 4 used Shiki themes instead of all ~60+ `bundledThemes`                                             | High     | Low    |
| 2    | **E10**     | Extension Memory | Call `tree.delete()` in tree-sitter + cache loaded `Language`/parsers                                             | High     | Low    |
| 3    | **E5**      | Extension IPC    | Add negative cache to OpenAI Codex & Kimi Code OAuth managers (`getStateToPostToWebview`)                         | High     | Low    |
| 4    | **W2**      | Startup IPC      | Remove duplicate `webviewDidLaunch` `useEffect` in `webview-ui/src/App.tsx:190`                                   | High     | Low    |
| 5    | **B1**      | VSIX Size        | Stop packaging 7 unused `tree-sitter-wasms` binaries (**10.17 MB** saved)                                         | High     | Low    |
| 6    | **W11**     | Webview Perf     | Hoist inline `React.forwardRef` out of `HistoryView` Virtuoso `components`                                        | High     | Low    |
| 7    | **W5**      | Webview Perf     | Remove unconditional per-row `useSize` iframe, `useSelectedModel` (6 queries), & `window` listener in `ChatRow`   | High     | Low    |
| 8    | **E1**      | Startup I/O      | Lazy-load only `"en"` + active locale instead of 18 languages / 126 sync JSON reads at import time                | High     | Low    |
| 9    | **E2**      | Startup / Memory | Dynamically import `./tiktoken` fallback (2.2 MB) + terminate `workerpool` in `deactivate()`                      | High     | Low    |
| 10   | **W15**     | Webview Bundle   | Lazy-load `MermaidBlock`/`mermaid` (~2 MB+) and non-chat views (`SettingsView`, `HistoryView`, `MarketplaceView`) | High     | Low    |
| 11   | **W16**     | Startup I/O      | Stop `sourceMapInitializer.ts` from re-fetching the main JS bundle & injecting 5 preload tags on boot             | Med–High | Low    |
| 12   | **Z1 / Z4** | Zombie Code      | Delete dead `textMateToHljs` theme pipeline + fix inverted `src/utils/logging/index.ts:25`                        | Medium   | Low    |

---

## Part 1: Performance & Optimization — Extension Host (`src/`)

### 1.1 Startup & Activation Path

#### E1. Synchronous eager loading of all 18 languages / 126 i18n JSON files (836 KB) at import time

- **Locations**: `src/i18n/setup.ts:10-69` (imported eagerly via `src/extension.ts:53` → `src/i18n/index.ts`)
- **Evidence**: Before `activate()` runs, module top-level code synchronously executes `fs.readdirSync(localesDir)`, `fs.readdirSync(langPath)` for all 18 locale directories, and `fs.readFileSync` + `JSON.parse` across all **126 JSON files (836 KB)** in `src/i18n/locales/`. Only `"en"` and the active VS Code display language are ever needed.
- **Impact**: High (145 sync filesystem syscalls + 126 `JSON.parse` calls blocking activation) | **Effort**: Low
- **Recommendation**: Load only `"en"` and the active language lazily inside `initializeI18n(language)`.

#### E2. Main bundle eagerly imports 2.2 MB `tiktoken/encoders/o200k_base` + worker pool leak

- **Locations**: `src/utils/countTokens.ts:5,7,18-23,40-44`; `src/utils/tiktoken.ts:3`; `src/extension.ts:334-353`
- **Evidence**:
    - `countTokens.ts:5` statically imports `{ tiktoken } from "./tiktoken"`, which statically imports `tiktoken/encoders/o200k_base` (**2.2 MB**). Because `BaseProvider` (`src/api/providers/base-provider.ts:9`) imports `countTokens`, this pulls 2.2 MB of BPE ranks into the main extension host bundle even though `countTokens` defaults to `{ useWorker: true }`.
    - `pool` (`workerpool.pool(...)` at `countTokens.ts:19`) is never terminated in `deactivate()` (`src/extension.ts:334-353`), and on error (`countTokens.ts:41`) sets `pool = null` without calling `pool.terminate()`, leaking the worker thread.
- **Impact**: High | **Effort**: Low
- **Recommendation**: Dynamically `await import("./tiktoken")` only on the fallback path (`!useWorker || !pool` / `catch`), call `void pool?.terminate()` on error, and call a `terminateCountTokensPool()` helper from `deactivate()`.

#### E3. Uncached `migrateSettings` runs sequential disk checks on every activation (past removal deadline)

- **Locations**: `src/utils/migrateSettings.ts:14-67,72-118`, invoked at `src/extension.ts:136`
- **Evidence**: Runs on every `activate()` with no `globalState` completion marker, performing up to 7 sequential `await fileExistsAtPath(...)` disk checks. Line 14 explicitly states: `TODO: Remove this migration code in September 2025 (6 months after implementation)`.
- **Impact**: Low–Medium | **Effort**: Low
- **Recommendation**: Remove expired file migrations or gate behind a one-time `globalState` migration version flag.

#### E4. Eager OS Keychain / `SecretStorage` reads for all 36 secret keys on every activation

- **Locations**: `src/core/config/ContextProxy.ts:90-120`; `packages/types/src/global-settings.ts:354-395`
- **Evidence**: `ContextProxy.initialize()` issues 36 concurrent `this.originalContext.secrets.get(key)` IPC calls (`SECRET_STATE_KEYS` = 35 + `GLOBAL_SECRET_KEYS` = 1) during `activate()` (`src/extension.ts:163`), even though users typically configure 1–2 providers.
- **Impact**: Medium | **Effort**: Medium
- **Recommendation**: Consolidate secrets into a single JSON secret blob or lazily load non-active provider secrets on demand.

---

### 1.2 Core Task Loop, Webview State & Persistence Hot Paths

#### E5. Missing negative cache in OAuth managers triggers 2 sequential `SecretStorage` IPC calls on every `getStateToPostToWebview()`

- **Locations**: `src/core/webview/ClineProvider.ts:3324-3339`; `src/integrations/openai-codex/oauth.ts:429-437,471-479,545-548`; `src/integrations/kimi-code/oauth.ts:196-207,238-247`
- **Evidence**:
    - Every `postStateToWebview*()` awaits two sequential async IIFEs calling `isAuthenticated()`.
    - When signed out (the common case), `this.credentials` stays `null`, so `loadCredentials()` calls `await this.context.secrets.get(...)` on **every** state push.
    - When signed in with an expired token, `isAuthenticated()` → `getAccessToken()` can trigger a live HTTP token refresh inside `getStateToPostToWebview()`, stalling UI state updates.
- **Impact**: High | **Effort**: Low
- **Recommendation**: Add a `credentialsLoaded: boolean` negative-cache flag (invalidated on `saveCredentials`/`clearCredentials`), check stored credential presence without triggering network refresh for UI status, and avoid sequential `await`s.

#### E6. 38 full `postStateToWebview()` calls in `webviewMessageHandler.ts` resend entire `taskHistory` and `clineMessages`

- **Locations**: `src/core/webview/webviewMessageHandler.ts` (38 occurrences of `provider.postStateToWebview()`, e.g., lines 395, 566, 610, 923, 954, 958, 1035, 1140, 2028, 2114, 2120, 2258, 2265, 2281, 2286, 2291, 2673, 2769, 2897, 2989, 3000, 3040, 3047, 3069, 3088, 3099)
- **Evidence**: `webviewMessageHandler.ts` makes **38** calls to full `provider.postStateToWebview()` and **0** calls to `postStateToWebviewWithoutTaskHistory()` or `postStateToWebviewWithoutClineMessages()`. Every settings toggle or UI action serializes and transfers full `taskHistory` and `clineMessages` (also risking the stale-snapshot streaming race noted in `ClineProvider.ts:2942-2945`).
- **Impact**: High | **Effort**: Low–Medium
- **Recommendation**: Switch settings/config/UI handlers to `postStateToWebviewWithoutClineMessages()` (or `postStateToWebviewWithoutTaskHistory()` where appropriate), reserving full `postStateToWebview()` for initial hydration and bulk history mutations.

#### E7. O(N²) disk read-modify-write + `structuredClone` + `fsync` + triple-pass metrics on every message save

- **Locations**: `src/core/task/Task.ts:1632-1645,1730,1870-1900`; `src/core/task-persistence/taskMessages.ts:85-112`; `src/utils/safeWriteJson.ts:84-149`; `src/core/task-persistence/taskMetadata.ts:75`
- **Evidence**: On every `addToClineMessages()` / `saveClineMessages()`:
    1. `structuredClone(this.clineMessages)` deep-clones the full array (`Task.ts:1873`; same for `apiConversationHistory` at `Task.ts:1635`).
    2. `safeWriteJson` with `merge: true` (`taskMessages.ts:95-101`) acquires a file lock, scans directory for interrupted replacements, reads and `JSON.parse`s the entire existing `ui_messages.json` (`safeWriteJson.ts:125`), merges, streams JSON to `.tmp`, calls `fd.sync()`, and renames.
    3. `taskMetadata()` (`taskMetadata.ts:75`) runs `getApiMetrics(combineApiRequests(combineCommandSequences(messages.slice(1))))` — three full O(N) scans over `this.clineMessages`.
- **Impact**: High (O(N²) CPU/memory/I/O amplification on long tasks with large tool outputs/images) | **Effort**: Medium–High
- **Recommendation**: Maintain incremental token/cost metrics on `Task`, coalesce non-critical `saveClineMessages` writes, and avoid unnecessary `structuredClone` when snapshotting.

#### E8. `CustomModesManager.getCustomModes()` writes `globalState` on every TTL expiry even when unchanged

- **Locations**: `src/core/config/CustomModesManager.ts:356-402`
- **Evidence**: On TTL expiry, line 396 unconditionally runs `await this.context.globalState.update("customModes", mergedModes)` even if modes did not change. Also, `globalModes` Map (lines 374, 382–386) is populated and never read.
- **Impact**: Low–Medium | **Effort**: Low
- **Recommendation**: Compare against `this.cachedModes` before calling `globalState.update`, and remove the dead `globalModes` Map.

#### E9. `normalizeString()` compiles 8 `new RegExp()` instances per call inside fuzzy diff hot loop

- **Locations**: `src/utils/text-normalization.ts:48-64`; called from `src/core/diff/strategies/multi-search-replace.ts:20-21,549`
- **Evidence**: `normalizeString()` loops over `SMART_QUOTES` (4) and `TYPOGRAPHIC` (4), constructing `new RegExp(smart, "g")` on every call. `getSimilarity()` invokes it twice per sliding-window candidate.
- **Impact**: Medium | **Effort**: Low
- **Recommendation**: Pre-compile combined character-class regexes at module scope with a lookup map callback.

---

### 1.3 Search, Tree-Sitter, Workspace Watchers & Model Cache

#### E10. Tree-sitter WASM memory leak (never calls `.delete()`) + zero parser/WASM caching

- **Locations**: `src/services/tree-sitter/languageParser.ts:41-52,79-236`; `src/services/tree-sitter/index.ts:152,335`; `src/services/code-index/processors/parser.ts:152`
- **Evidence**:
    - There are **0** calls to `tree.delete()`, `parser.delete()`, or `query.delete()` in `src/services/tree-sitter/` or `src/services/code-index/processors/parser.ts`. In `web-tree-sitter`, C/WASM heap allocations are not reclaimed by JS GC — every file parsed during codebase indexing permanently leaks its AST in WASM memory.
    - `loadLanguage()` (`languageParser.ts:41-52`) has no module-level cache: every `parseSourceCodeDefinitionsForFile()` call reloads the `.wasm` binary from disk and allocates a fresh `Parser` + `Query`.
- **Impact**: High | **Effort**: Low
- **Recommendation**: Wrap `parser.parse(...)` in `try { ... } finally { tree?.delete() }` in `src/services/tree-sitter/index.ts:335` and `src/services/code-index/processors/parser.ts:152`, and cache loaded `Language` / `{ parser, query }` pairs in `languageParser.ts`.

#### E11. Synchronous `fs.existsSync` + `fs.lstatSync` inside `Promise.all` loop on every `@` file search

- **Locations**: `src/services/search/file-search.ts:148,172-187`
- **Evidence**: Inside `Promise.all(fzfResults.map(async ...))` (up to 20 results), lines 176–177 call `fs.existsSync(fullPath)` and `fs.lstatSync(fullPath)` synchronously (up to 40 blocking syscalls per keystroke). Line 148 also spawns a fresh `executeRipgrepForFiles(workspacePath)` process on every keystroke with no short-TTL cache.
- **Impact**: Medium | **Effort**: Low
- **Recommendation**: Use `fs.promises.lstat(fullPath)` (catching `ENOENT`) and add a short-TTL (2–5s) cache for `executeRipgrepForFiles` per workspace.

#### E12. `WorkspaceTracker` watches `**` without ignoring change events and resends up to 2,000 `filePaths` on every tab switch

- **Locations**: `src/integrations/workspace/WorkspaceTracker.ts:42,64-72,127-132`
- **Evidence**:
    - Line 42 calls `vscode.workspace.createFileSystemWatcher("**")` without `ignoreChangeEvents = true`, despite never subscribing to `onDidChange`.
    - Lines 64–72 call `workspaceDidUpdate()` on every `onDidChangeTabs`, resending up to 2,000 `filePaths` to the webview even though only `openedTabs` changed.
- **Impact**: Medium | **Effort**: Low
- **Recommendation**: Pass `(pattern, false, true, false)` to `createFileSystemWatcher` and send tab-only updates when `filePaths` did not change.

#### E13. `RooIgnoreController.validateAccess()` calls synchronous `fsSync.realpathSync` uncached in loops

- **Locations**: `src/core/ignore/RooIgnoreController.ts:89-116` (line 100)
- **Evidence**: When `.rooignore` exists, every `validateAccess(filePath)` call (used in file listing, search, and tree-sitter loops) runs a synchronous `fsSync.realpathSync(absolutePath)` syscall with no caching.
- **Impact**: Medium | **Effort**: Low
- **Recommendation**: Memoize resolved realpaths in a bounded LRU/TTL cache invalidated on `.rooignore` change.

#### E14. `getModelsFromCache()` lacks negative caching and runs sync disk read + Zod validation on cold start

- **Locations**: `src/api/providers/fetchers/modelCache.ts:525-565`
- **Evidence**: On memory miss, lines 543–549 execute synchronous `fsSync.existsSync`, `fsSync.readFileSync`, `JSON.parse`, and `modelRecordSchema.safeParse(models)`. Missing cache files are never negatively cached in `memoryCache`, repeating sync `existsSync` on every call.
- **Impact**: Low–Medium | **Effort**: Low
- **Recommendation**: Negative-cache missing keys in `memoryCache` (cleared by `writeModels`).

---

## Part 2: Performance & Optimization — Webview UI (`webview-ui/`)

### 2.1 Context Architecture & Startup Sync

#### W1. Monolithic `ExtensionStateContext` re-renders the entire tree on every streaming chunk

- **Locations**: `webview-ui/src/context/ExtensionStateContext.tsx:169,329-392,511-542,652-787`
- **Evidence**: Combines high-frequency streaming state (`clineMessages`, `currentCheckpoint`), medium-frequency state (`taskHistory`, `filePaths`, `openedTabs`, `mcpServers`), and low-frequency settings into a single context consumed at **80 call sites across 40 non-test files**. On every `messageUpdated` chunk, `setState` clones `clineMessages`, creating a new `contextValue` and forcing every `useExtensionState()` consumer to re-render. (`babel-plugin-react-compiler` is active in `vite.config.ts:74`, which memoizes inline setters, but cannot prevent context propagation when `state` changes.)
- **Impact**: High | **Effort**: High
- **Recommendation**: Split into (1) stable actions/setters context, (2) streaming chat/task messages context (or selector-backed `useSyncExternalStore` / Zustand store), and (3) settings/workspace/history state.

#### W2. Duplicate `webviewDidLaunch` PostMessage on every webview mount

- **Locations**: `webview-ui/src/App.tsx:190`; `webview-ui/src/context/ExtensionStateContext.tsx:637-639`; `src/core/webview/webviewMessageHandler.ts:605-655`
- **Evidence**: Both `App` (`App.tsx:190`) and `ExtensionStateContextProvider` (`ExtensionStateContext.tsx:639`) post `{ type: "webviewDidLaunch" }` on mount. This runs the entire startup hydration pipeline **twice** (reload `customModes`, full `postStateToWebview()`, `workspaceTracker.initializeFilePaths()`, `getTheme()`, `mcpServers`, `listApiConfig`).
- **Impact**: High | **Effort**: Low
- **Recommendation**: Remove the duplicate `useEffect` in `webview-ui/src/App.tsx:190`.

#### W3. Full `taskHistory` re-sort on every `taskHistoryItemUpdated` & full `historyCache.clear()` on every `state`

- **Locations**: `webview-ui/src/context/ExtensionStateContext.tsx:441-444,596-624`
- **Evidence**: Every `state` message clears and re-interns the entire `historyCache`, and every `taskHistoryItemUpdated` clones and runs `nextHistory.sort((a, b) => b.ts - a.ts)` over the full array even when `ts` did not change.
- **Impact**: Medium | **Effort**: Low
- **Recommendation**: Skip re-interning when `taskHistory` is unchanged, and avoid full `Array.prototype.sort` when updating an existing item with an unchanged `ts`.

---

### 2.2 Chat & Message Rendering Pipeline

#### W4. `ChatRow` memoization defeated during streaming (four compounding issues)

- **Locations**: `webview-ui/src/components/chat/ChatView.tsx:1596-1655`; `webview-ui/src/components/chat/ChatRow.tsx:174-206,210-256`
- **Evidence**:
    1. `ChatRowContent` calls `useExtensionState()` and destructures `clineMessages` (`ChatRow.tsx:227-238`), bypassing `ChatRow`'s `React.memo` on every streaming token for **every mounted row**.
    2. `ChatView.tsx:1607,1640` passes `lastModifiedMessage={modifiedMessages.at(-1)}` to **every** row, invalidating `memo` for all visible rows on every chunk even though `ChatRowContent` only reads `lastModifiedMessage` when `isLast === true` (`ChatRow.tsx:311,316,318`).
    3. `ChatView.tsx:1598` runs `modifiedMessages.some((m) => m.say === "checkpoint_saved")` (O(N)) inside `itemContent` for every visible row instead of hoisting to `useMemo`.
    4. `ChatRow.tsx:205` runs `fast-deep-equal` over full message payloads on every `ChatView` render (including every keystroke in `ChatTextArea`).
- **Impact**: High | **Effort**: Medium
- **Recommendation**: Pass `lastModifiedMessage` only when `isLast` (or pass 3 derived booleans), hoist `hasCheckpoint` to `useMemo`, and remove `useExtensionState()` from `ChatRowContent`.

#### W5. Every `ChatRow` mounts a hidden `<iframe>` (`useSize`), 6 React Query observers, and a global `window` message listener

- **Locations**: `webview-ui/src/components/chat/ChatRow.tsx:181-199,239,246-256,1292`; `webview-ui/src/components/ui/hooks/useSelectedModel.ts:114-124`
- **Evidence**:
    - `useSize` (`react-use`, line 181) injects an `<iframe>` into **every** mounted `ChatRow`, even though `height` is only used when `isLast === true` (line 193).
    - `useSelectedModel(apiConfiguration)` (line 239) subscribes **every** row to 6 React Query hooks (`useRouterModels`, `useOpenRouterModelProviders`, `useLmStudioModels`, `useOllamaModels`, `useGitHubCopilotModels`, `useVsCodeLmModels`), yet `model` is only read at line 1292 when `isEditing === true`.
    - Lines 246–256 attach `window.addEventListener("message", ...)` unconditionally on every mounted row, even when `isEditing === false`.
- **Impact**: High | **Effort**: Low
- **Recommendation**: Replace `useSize` with a `ResizeObserver` attached only when `isLast` is true; move `useSelectedModel` and the `window` listener into an edit-mode-only child component.

#### W6. `CodeBlock` causes N× per-frame scroll layout thrashing, per-block `MutationObserver`s, and unthrottled streaming Shiki + stale-highlight race

- **Locations**: `webview-ui/src/components/common/CodeBlock.tsx:203-214,217-309,362-452,585-607`
- **Evidence**:
    - Every `CodeBlock` registers non-passive, non-throttled `scroll` and `resize` listeners calling `updateCodeBlockButtonPosition()`, which runs up to 3 `getBoundingClientRect()` + 2 `getComputedStyle()` calls and mutates 6 CSS custom properties + `setAttribute()` — causing synchronous read-write forced reflows multiplied by every visible `CodeBlock`.
    - Each `CodeBlock` creates its own `MutationObserver` on `documentElement`/`body` (lines 203–214) and a global `document.addEventListener("mouseup", ...)` (lines 585–607).
    - Every streaming character update triggers unthrottled async `highlighter.codeToHast` + `toJsxRuntime`, and shared `isMountedRef.current` (reset at line 219) allows a slower earlier highlight call to overwrite newer output.
- **Impact**: High | **Effort**: Medium
- **Recommendation**: Replace JS scroll tracking with CSS `position: sticky` (or a single shared `rAF` scroll manager), use a single module-level theme subscription, attach `mouseup` only while `isSelecting`, use a per-effect `let cancelled = false`, and throttle streaming highlights.

#### W7. `MarkdownBlock` recreates `remarkPlugins` / `rehypePlugins` inline every render & re-parses full markdown per token

- **Locations**: `webview-ui/src/components/common/MarkdownBlock.tsx:397-422`
- **Evidence**: Passes inline `remarkPlugins` / `rehypePlugins` arrays (with an inline anonymous AST visitor plugin) on every render, and re-runs the full Unified + GFM + Math + KaTeX + GitHub Alerts pipeline synchronously on every streaming token.
- **Impact**: Medium | **Effort**: Low
- **Recommendation**: Hoist `REMARK_PLUGINS` and `REHYPE_PLUGINS` to module scope; consider `useDeferredValue` or block-level splitting for long streaming responses.

#### W8. `ChatView` re-renders 2,000-line component on every keystroke & constructs `new LRUCache(...)` every render

- **Locations**: `webview-ui/src/components/chat/ChatView.tsx:188,217-222,1958-1985`
- **Evidence**: `inputValue` state at line 188 re-renders the entire `ChatView` subtree on every keystroke. Lines 217–222 pass `new LRUCache({ max: 100, ttl: 1000 * 60 * 5 })` directly to `useRef(...)`, allocating and discarding a new `LRUCache` instance on every render.
- **Impact**: Medium | **Effort**: Low (`LRUCache`) / Medium (composer state isolation)
- **Recommendation**: Lazy-initialize `everVisibleMessagesTsRef` (or `useState(() => new LRUCache(...))[0]`), and isolate `inputValue` inside the composer component.

#### W9. `FileChangesPanel` resets expanded state & re-scans all messages on every streaming chunk

- **Locations**: `webview-ui/src/components/chat/FileChangesPanel.tsx:41-52`
- **Evidence**: `useEffect([clineMessages, taskId])` resets `expandedPaths` and `finalContentByPath` and re-runs `fileChangesFromMessages(clineMessages)` on every streaming chunk, causing extra renders and collapsing open diffs.
- **Impact**: Medium | **Effort**: Low
- **Recommendation**: Key the reset effect on `taskId` and a fingerprint of actual file-edit message timestamps.

#### W10. `getContextMenuOptions` reconstructs `new Fzf(...)` on every keystroke

- **Locations**: `webview-ui/src/utils/context-mentions.ts:163,202,334`
- **Evidence**: Instantiates fresh `new Fzf(...)` indices over `commands`, `modes`, and `queryItems` (all workspace files/tabs/commits) on every `@`/`/` keystroke.
- **Impact**: Low–Medium | **Effort**: Low
- **Recommendation**: Memoize `Fzf` instances by source list (e.g., `WeakMap` cache).

---

### 2.3 Secondary Views (`HistoryView`, `SettingsView`, `MarketplaceListView`)

#### W11. `HistoryView` passes inline `React.forwardRef` to Virtuoso `components`, unmounting/remounting the entire list every render

- **Locations**: `webview-ui/src/components/history/HistoryView.tsx:262-266,267-279,288-292,293-307`; `webview-ui/src/components/history/useTaskSearch.ts:42-82`
- **Evidence**: Lines 262–266 and 288–292 create a new `React.forwardRef(...)` component identity on every render, forcing React to unmount and remount the entire Virtuoso DOM list on every search keystroke, sort toggle, or checkbox click. Also uses `selectedTaskIds.includes(...)` (O(K) per row) and unthrottled `fzf.find(searchQuery)`.
- **Impact**: High | **Effort**: Low
- **Recommendation**: Hoist `VirtuosoList` and `VIRTUOSO_COMPONENTS` to module scope, use a `Set<string>` for `selectedTaskIds`, memoize `itemContent`, and defer `searchQuery` with `useDeferredValue`.

#### W12. `SettingsView` synchronously mounts & unmounts all 17 settings tabs on every open to build its search index

- **Locations**: `webview-ui/src/components/settings/SettingsView.tsx:660-694,816-820`
- **Evidence**: On every mount, `useLayoutEffect` steps `indexingTabIndex` from `0` through all 17 sections while hidden with `opacity-0`, mounting/unmounting `ApiOptions`, 1,789-line `ModesView`, `McpView`, `WorktreesView`, etc. sequentially.
- **Impact**: High (visible jank whenever Settings opens) | **Effort**: Medium
- **Recommendation**: Replace runtime DOM crawling with a static declarative search manifest (keyed by i18n keys + `section` + `settingId`), or cache the built index at module scope per locale.

#### W13. Unvirtualized `MarketplaceListView` grids + inline props breaking card memoization

- **Locations**: `webview-ui/src/components/marketplace/MarketplaceListView.tsx:235-251,268-284`
- **Evidence**: Renders all marketplace cards without virtualization and passes fresh inline `setFilters` and `installed` objects on every filter keystroke.
- **Impact**: Low–Medium | **Effort**: Low
- **Recommendation**: Stabilize `setFilters` with `useCallback` and virtualize/paginate if catalog size grows.

---

### 2.4 Bundle, Assets & Vite Build Configuration

#### W14. Shiki eagerly loads ALL ~60+ `bundledThemes` at startup when only 4 are ever used

- **Locations**: `webview-ui/src/utils/highlighter.ts:6-7,153-156`; `webview-ui/src/index.tsx:14`; `webview-ui/src/components/common/CodeBlock.tsx:17-21`; `webview-ui/src/utils/highlightDiff.ts:20`
- **Evidence**: `index.tsx:14` eagerly calls `getHighlighter()`, which passes `themes: Object.keys(bundledThemes) as BundledTheme[]` to `createHighlighter(...)`. Across the entire codebase, only **4 themes** are ever used: `"github-light-high-contrast"`, `"github-dark-high-contrast"`, `"github-light"`, and `"github-dark"`.
- **Impact**: High (startup CPU, memory, and bundle size) | **Effort**: Low
- **Recommendation**: Pass only the 4 used themes (or use `shiki/core` with explicit imports for those 4 themes and on-demand grammars).

#### W15. `mermaid` (~2 MB+) and secondary views eagerly bundled in main entry chunk

- **Locations**: `webview-ui/src/components/common/MermaidBlock.tsx:2`; `MarkdownBlock.tsx:13`; `webview-ui/src/App.tsx:15-18`; `SettingsView.tsx:85-87`; `webview-ui/src/index.css:23`
- **Evidence**: `MarkdownBlock` eagerly imports `MermaidBlock` → `mermaid` (Cytoscape/D3/Dagre), pulling the full diagram stack into the main entry bundle. `App.tsx` eagerly imports `HistoryView`, `SettingsView` (which eagerly imports `ModesView`, `McpView`, `WorktreesView`), `MarketplaceView`, and `WelcomeView`.
- **Impact**: High | **Effort**: Low
- **Recommendation**: Lazy-load `MermaidBlock` (or dynamic `import("mermaid")`) and wrap `HistoryView`, `SettingsView`, `MarketplaceView`, and `WelcomeView` in `React.lazy` + `<Suspense>`.

#### W16. `initializeSourceMaps()` re-fetches entire production JS bundle & injects 5 speculative `<link rel="preload">` tags per script on boot

- **Locations**: `webview-ui/src/App.tsx:215`; `webview-ui/src/utils/sourceMapInitializer.ts:57-109`; `webview-ui/src/utils/sourceMapUtils.ts:1`
- **Evidence**: On every production boot, `initializeSourceMaps()` injects **5 `<link rel="preload" as="fetch">`** tags per `<script>` (`.map`, `?source-map=true`, `.js.map`, `.map.json`, `.sourcemap` — at least 4 of which 404), re-fetches and regex-scans the entire multi-MB JS bundle via `fetch(script.src).then((r) => r.text())`, and eagerly bundles `stacktrace-js` into the entry chunk.
- **Impact**: Medium–High | **Effort**: Low
- **Recommendation**: Remove the speculative preload loop and `fetch(script.src)` scan; dynamically `import("./sourceMapUtils")` only inside error/rejection handlers if an error occurs.

> **Verification Note (React Compiler)**: `babel-plugin-react-compiler` (`1.0.0`, `target: "18"`) **is** actively enabled in `webview-ui/vite.config.ts:74` alongside `react-compiler-runtime`. Both `knip.json:58,60` ignores are legitimate.

---

## Part 3: Build, VSIX Packaging, Dependencies & Test Infrastructure

#### B1. 10.17 MB of unused `tree-sitter-wasms` binaries packaged into every VSIX

- **Locations**: `packages/build/src/esbuild.ts:151-156`; `src/services/tree-sitter/languageParser.ts:41-236`; `src/__tests__/dist_assets.spec.ts:19,27,33,36,40,41,54`
- **Evidence**: `packages/build/src/esbuild.ts` unconditionally copies all 36 `.wasm` files (49.37 MB uncompressed), while `languageParser.ts` only loads **29**. Seven binaries (**10.17 MB uncompressed**) are never loaded anywhere in `src/`:
    - `tree-sitter-objc.wasm` (**7,528 KB**)
    - `tree-sitter-bash.wasm` (**1,367 KB**)
    - `tree-sitter-rescript.wasm` (**662 KB**)
    - `tree-sitter-ql.wasm` (**532 KB**)
    - `tree-sitter-yaml.wasm` (**179 KB**)
    - `tree-sitter-elm.wasm` (**145 KB**)
    - `tree-sitter-json.wasm` (**6 KB** — `.json` uses `tree-sitter-javascript.wasm` at `languageParser.ts:103-104`)
- **Impact**: High (~10.17 MB uncompressed / ~3–4 MB compressed VSIX savings) | **Effort**: Low
- **Recommendation**: Copy only an explicit allowlist matching `languageParser.ts` and update `dist_assets.spec.ts`.

#### B2. 13 MB `esbuild-wasm` binary bundled into VSIX (and declared only in `devDependencies`)

- **Locations**: `packages/build/src/esbuild.ts:161,176-219`; `src/package.json:571`; `knip.json:38`
- **Evidence**: `dist/esbuild.wasm` adds **13 MB** uncompressed to every VSIX solely for experimental runtime custom-tool transpilation, and is declared under `devDependencies`.
- **Impact**: High | **Effort**: Medium
- **Recommendation**: Evaluate using Node 22's built-in TypeScript type stripping (`engines.node` is `22.23.4`) or lazy-loading `esbuild-wasm` on opt-in.

#### B3. Duplicate VSIX assets & unconditional production sourcemaps

- **Locations**:
    - `src/esbuild.mjs:79` + `src/.vscodeignore:14,34`: **`assets/marketplace/` (284 KB) is packaged twice** (`assets/marketplace` and `dist/assets/marketplace`).
    - `packages/build/src/esbuild.ts:118-134`: **`tiktoken_bg.wasm` (1.0 MB) is copied twice** (`dist/tiktoken_bg.wasm` and `dist/workers/tiktoken_bg.wasm` = **2.0 MB**).
    - `src/esbuild.mjs:36` (`const sourcemap = true`) + `src/.vscodeignore:17` (`!**/*.map`): all `.js.map` files ship in every production VSIX.
- **Impact**: High | **Effort**: Low
- **Recommendation**: Drop `!assets/marketplace/**` from `src/.vscodeignore:34`, load a single `dist/tiktoken_bg.wasm` via `tiktoken/lite/init` with explicit path, and exclude `.map` files from production VSIX (archive them as release artifacts instead).

#### B4. Dependency skew, type-only runtime dep, React 18/19 mismatch, & root duplication

- **Locations**:
    - `packages/core/package.json:27`: `"openai": "^5.12.2"` is in `dependencies`, but `packages/core/src/custom-tools/format-native.ts:1` only uses `import type { OpenAI } from "openai"`.
    - `apps/cli/package.json:34,41`: uses `react: "^19.1.0"` against `"@types/react": "18.3.31"` (pinned by root override `package.json:126`), while `webview-ui` uses `react: "^18.3.1"`.
    - Workspace version skew candidates for `pnpm-workspace.yaml` `catalog:`: `zod` (`4.6.7` vs `^4.0.0`), `esbuild` (`0.28.2` vs `^0.28.1`), `yaml` (`2.9.1` vs `^2.8.0`), `rimraf` (4 packages).
    - Redundant root `devDependencies` already declared in their sole consuming workspace: `@vscode/test-electron`, `@vscode/vsce`, `ovsx`.
- **Impact**: Medium | **Effort**: Low
- **Recommendation**: Move `openai` to `devDependencies` (or replace with a local structural type), centralize shared versions in `pnpm-workspace.yaml` `catalog:`, and prune redundant root `devDependencies`.

#### B5. Broken `src/vitest.config.ts` coverage glob, workflow test double-execution, & 9-config sprawl

- **Locations**: `src/vitest.config.ts:24`; `src/vitest.workflow.config.ts:9-14`; `src/vitest.services.config.ts:10-14`; `src/vitest.unit.config.ts:9-14`; `src/turbo.json:23-231`
- **Evidence**:
    - `src/vitest.config.ts:24` sets `coverage.include: ["src/**/*.ts", "src/**/*.tsx", "eslint-rules/**/*.mjs"]` — relative to `src/`, neither `src/src/` nor `src/eslint-rules/` exists, so the glob matches **0 files**.
    - `vitest.workflow.config.ts` runs 4 workflow tests, but `vitest.services.config.ts` and `vitest.unit.config.ts` only exclude 2 of the 4 — causing `fork-review-followup-workflow.test.ts` and `workflow-self-listen.test.ts` to **execute twice**.
    - `src/turbo.json:81,186` only excludes 1 of the 4 (`pr-review-state-workflow.test.ts`), causing unnecessary Turbo cache invalidation on `test:services`.
    - 9 separate `src/vitest.*.config.ts` files duplicate ~180 lines of negation globs in `src/turbo.json`.
- **Impact**: Medium | **Effort**: Low (glob/exclusion fixes) / Medium (Vitest `test.projects` consolidation)
- **Recommendation**: Fix `coverage.include` in `src/vitest.config.ts:24`, align all 4 workflow exclusions across Vitest configs and `src/turbo.json`, and consolidate into Vitest 4.1 `test.projects`.

---

## Part 4: Zombie Code, Dead Code & Redundant Code

### 4.1 Zombie Packages & Runtime No-Op Shells

#### Z1. `@roo-code/cloud` is 100% uninitialized at runtime (2,887 LOC zombie package + dead integration)

- **Locations**:
    - `packages/cloud/src/CloudService.ts:382` (`CloudService.createInstance` — **0 call sites** across `src/`, `apps/`, `webview-ui/`)
    - `packages/cloud/src/index.ts:5` (`RetryQueue` — **0 external imports**)
    - `src/extension.ts:142,283` (`MdmService.createInstance()` still runs sync `fs.existsSync`/`fs.readFileSync` on boot; dev watcher still watches `node_modules/@roo-code/cloud`)
    - `src/core/webview/ClineProvider.ts:89,412-413,686-695,1051-1053,3158-3178,3276-3279,3302-3304,3387-3422,3660-3665,4544-4556` (`handleCloudSettingsUpdate` and `initializeCloudProfileSyncWhenReady` have 0 prod callers; `CloudService.hasInstance()` branches are unreachable)
    - `src/core/task/Task.ts:63,702,1732-1741,1761-1766,1844-1854` (`cloudSyncedMessageTimestamps: Set<number>` still allocated/populated on every hydration even though `CloudService.isEnabled()` is always `false`)
    - `src/core/webview/webviewMessageHandler.ts:38,153,3003-3050,3134-3195` (dead cloud sign-in/out/org handlers)
    - `src/services/mdm/MdmService.ts:6,69-114` (`isCompliant()` depends on `CloudService.hasInstance()`)
    - `webview-ui/src/context/ExtensionStateContext.tsx:60-63,111-112,267,297-300,673-674,681,719` (`cloudIsAuthenticated`, `cloudOrganizations`, `sharingEnabled`, `publicSharingEnabled`, `taskSyncEnabled`, `setTaskSyncEnabled` have **0 consumers** in `webview-ui/src/`)
- **Impact**: High | **Effort**: Medium
- **Recommendation**: In Phase 2 of `refactor/standalone-independence`, delete `packages/cloud/`, remove `@roo-code/cloud` from `src/package.json:497`, remove dead `CloudService`/`MdmService` branches across `src/` and unused cloud fields from `ExtensionStateContext`.

#### Z2. `@roo-code/telemetry` is a runtime no-op shell + stale `POSTHOG_API_KEY` & `@types/vscode`

- **Locations**: `src/extension.ts:139,206`; `packages/telemetry/src/TelemetryService.ts:63,92-94,430`; `packages/telemetry/src/BaseTelemetryClient.ts:9-75`; `packages/telemetry/package.json:22`; `knip.json:93`; `src/turbo.json:250`; `src/scripts/verify-build-cache-inputs.mjs:195-198`
- **Evidence**: `TelemetryService.createInstance()` is called with 0 clients, `register()` has 0 prod callers, and `BaseTelemetryClient` has 0 subclasses after `PostHogTelemetryClient.ts` removal — every `capture*()` call across 26 files immediately returns. `@types/vscode` is unused in `packages/telemetry`. `POSTHOG_API_KEY` was removed from `src/esbuild.mjs` but remains in `src/turbo.json:250` and `verify-build-cache-inputs.mjs:195-198`.
- **Impact**: High | **Effort**: Low (stale config cleanup) / Medium (full removal)
- **Recommendation**: Immediately remove `POSTHOG_API_KEY` from `src/turbo.json:250` and `verify-build-cache-inputs.mjs:195-198` and drop `@types/vscode` from `packages/telemetry/package.json:22` & `knip.json:93`. Decide whether to delete `packages/telemetry` or replace with a minimal no-op stub.

---

### 4.2 Dead Pipelines & Inverted Logic Bugs

#### Z3. Completely dead TextMate-to-HLJS theme pipeline

- **Locations**: `webview-ui/src/utils/textMateToHljs.ts` (entire file); `webview-ui/src/context/ExtensionStateContext.tsx:38,51,362,493-498,663`; `src/core/webview/webviewMessageHandler.ts:615-617`
- **Evidence**: Extension host reads/serializes the VS Code TextMate theme JSON and sends `{ type: "theme" }`; `ExtensionStateContext` parses it via `convertTextMateToHljs()` and stores it in `theme`. **Zero components in `webview-ui/src/` read `theme`** (Shiki uses VS Code body classes).
- **Impact**: Medium (wasted startup/theme-change CPU & IPC) | **Effort**: Low
- **Recommendation**: Delete `textMateToHljs.ts`, remove `theme`/`setTheme`/`case "theme"` from `ExtensionStateContext.tsx`, and stop sending `{ type: "theme" }` in `webviewMessageHandler.ts`.

#### Z4. Inverted `NODE_ENV === "test"` check makes `src/utils/logging/` a silent no-op in prod & sync disk writer in tests

- **Locations**: `src/utils/logging/index.ts:25`; `src/utils/logging/CompactLogger.ts`; `src/utils/logging/CompactTransport.ts:64-119`
- **Evidence**: `index.ts:25` exports `process.env.NODE_ENV === "test" ? new CompactLogger() : noopLogger` — the exact opposite of its doc comment on line 23. In production, `logger.error(...)` calls silently no-op; in tests, `CompactTransport` runs synchronous `mkdirSync`/`writeFileSync` to `src/logs/`.
- **Impact**: Medium | **Effort**: Low
- **Recommendation**: Remove `CompactLogger`/`CompactTransport` and route callers to `outputChannelLogger`/`console.error`, or fix the condition using async streams.

---

### 4.3 Test-Only Zombie Files & Stale `knip.json` Exclusions

#### Z5. Four test-only zombie production files hidden behind `knip.json` `!` exclusions + stale Knip config

- **Locations**: `knip.json:25-31,56,61,71-73`
- **Evidence**:
    - **4 dead production files** (imported ONLY by their own unit tests, 0 production callers):
        1. `src/utils/WorkspacePathResolver.ts` (68 lines)
        2. `src/utils/versionToken.ts` (48 lines)
        3. `src/services/tools/Bm25Ranker.ts` (105 lines)
        4. `src/core/tools/helpers/toolResultFormatting.ts` (10 lines — also has an entry in `src/eslint-suppressions.json:887`)
    - **1 non-existent workspace in `knip.json:71-73`**: `"apps/vscode-nightly"` (`apps/` only has `cli` and `vscode-e2e`).
    - **2 stale exclusions for live files**: `src/utils/TaskSemaphore.ts` (`knip.json:25`, imported by `TaskScheduler.ts:1`) and `src/services/tools/types.ts` (`knip.json:30`, imported by `ToolRouter.ts:5`).
    - **2 unused ignored deps in `webview-ui/package.json` & `knip.json:56,61`**: `source-map` (0 imports anywhere in `webview-ui/`) and `@types/katex` (`katex` JS API never imported).
- **Impact**: Medium | **Effort**: Low
- **Recommendation**: Delete or wire up the 4 orphaned files, remove `apps/vscode-nightly` and the 2 stale exclusions from `knip.json`, and uninstall `source-map` and `@types/katex` from `webview-ui`.

---

### 4.4 Dead Modules, Configs, Scripts, Exports & CSS

| ID      | Location                                                                                                                           | Evidence                                                                                                  | Recommendation                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Z6**  | `packages/config-eslint/next.js`, `packages/config-typescript/nextjs.json`, `packages/config-eslint/package.json:8,21`             | 0 consumers of Next.js configs or `@next/eslint-plugin-next` (still churned by Renovate)                  | Delete files & remove dep                                 |
| **Z7**  | `packages/types/src/cookie-consent.ts`, `packages/types/src/index.ts:6`                                                            | 0 references anywhere (web-app leftover)                                                                  | Delete file & re-export                                   |
| **Z8**  | `packages/build/vitest.config.ts`, `packages/build/package.json:18`                                                                | 0 test files and no `test` script, yet declares `vitest`                                                  | Add tests or remove config & dep                          |
| **Z9**  | `scripts/find-missing-i18n-key.js` (204 lines)                                                                                     | 0 references in `package.json`/CI/docs; superseded by ESLint `i18n-keys` & `find-missing-translations.js` | Delete script                                             |
| **Z10** | `apps/cli/package.json:20-21`, `apps/cli/README.md:247-250`                                                                        | Hardcoded Roo Code Cloud dev URLs (`app.roocode.com`, `cloud-api.roocode.com`, `api.roocode.com`)         | Strip dead env vars                                       |
| **Z11** | `src/utils/config.ts:22` (`injectEnv`)                                                                                             | 0 production callers (test-only; `McpHub.ts` only uses `injectVariables`)                                 | Delete export & tests                                     |
| **Z12** | `webview-ui/src/oauth/urls.ts:13-15` (`getRequestyAuthUrl`) & `webview-ui/src/utils/sourceMapUtils.ts:171-192` (`parseStackTrace`) | 0 production callers (test-only / legacy compat)                                                          | Use `getRequestyAuthUrl` in `Requesty.tsx` or delete both |
| **Z13** | `webview-ui/src/components/settings/ModelDescriptionMarkdown.tsx:14,19,41`                                                         | Destructures React-reserved `key` prop (always `undefined`)                                               | Remove `key` prop                                         |
| **Z14** | `webview-ui/src/index.css:332-354`                                                                                                 | `.dropdown-container`, `#api-provider > div > ul` have 0 matches in `webview-ui/src/`                     | Delete dead CSS rules                                     |

---

### 4.5 Orphaned i18n Keys

- **`src/package.nls*.json` (all 18 files)**: `command.documentation.title` is unreferenced in `src/package.json`.
- **`src/i18n/locales/` (836 KB)**: **86** orphaned non-plural key entries across 17 non-`en` locales (16 keys absent from `en/`, e.g., `common.json:mdm.errors.manual_url_*`, `tools.json:searchFiles.workspaceBoundaryError`).
- **`webview-ui/src/i18n/locales/` (2.4 MB)**: **196** orphaned non-plural key entries across 17 non-`en` locales (23 keys absent from `en/`, e.g., `chat.json:rooCloudCTA.*`, `chat.json:instructions.wantsToFetch`, `history.json:viewAll/tokens/cache/apiCost`).
- **Recommendation**: Prune orphaned keys and extend `scripts/find-missing-translations.js` to flag non-plural keys absent from `en/`.

---

### 4.6 Redundant / Duplicated Code & Overlapping Libraries

1. **Duplicate `escapeRegExp` (×3)** in `src/core/tools/EditFileTool.ts:83`, `src/core/tools/EditTool.ts:272`, and `src/core/tools/ReadCommandOutputTool.ts:439` → consolidate into one shared util.
2. **Duplicate `fileExists`** in `src/services/roo-config/index.ts:128` vs `fileExistsAtPath` in `src/utils/fs.ts` → reuse `fileExistsAtPath`.
3. **4 single-line re-export shims** in `src/shared/` (`combineApiRequests.ts`, `combineCommandSequences.ts`, `core.ts`, `getApiMetrics.ts`) wrapping `@roo-code/core/browser` → import directly or consolidate into `core.ts`.
4. **Split mention helpers & uncached `Intl.NumberFormat`**: `escapeSpaces` (`webview-ui/src/utils/path-mentions.ts:11-13`) vs `unescapeSpaces` (`src/shared/context-mentions.ts:71-73`) should live together; `webview-ui/src/utils/formatPrice.ts:1-8` allocates `new Intl.NumberFormat(...)` on every call instead of reusing a module singleton.
5. **Overlapping `webview-ui` libraries**:
    - **2 Markdown engines**: `react-remark` used in **1 file** (`ModelDescriptionMarkdown.tsx:3`) vs `react-markdown` everywhere else.
    - **4 icon libraries**: `react-icons` used in **1 file** (`Announcement.tsx:3`, 3 icons) alongside `lucide-react`, `@vscode/codicons`, and `@radix-ui/react-icons` (5 files).
    - **`styled-components` in only 4 files** (`CodeBlock.tsx`, `MarkdownBlock.tsx`, `MermaidBlock.tsx`, `settings/styles.ts`) alongside Tailwind CSS v4.
    - **3 checkbox implementations**: `vscrui` (11 settings files + CSS overrides in `index.css:407-417`), `@radix-ui/react-checkbox`, and `@vscode/webview-ui-toolkit/react`.

---

### 4.7 `src/eslint-suppressions.json` Health

- **Total**: **2,847** suppressions across 262 files (100% `@typescript-eslint/no-explicit-any`): **323** in 77 production files (top 3: `api/providers/bedrock.ts`: 32, `api/providers/openai-codex.ts`: 31, `api/providers/openai-native.ts`: 27; `core/task/Task.ts`: 17) and **2,516** in 184 test files.
- **Stale / Dead Entries**:
    - 2 deleted files still listed (11 phantom suppressions): `api/providers/fetchers/__tests__/zoo-gateway.spec.ts` (8) and `services/__tests__/zoo-code-auth.test.ts` (3).
    - 1 dead file: `core/tools/helpers/toolResultFormatting.ts` (Z5).
- **Recommendation**: Run `pnpm --dir src exec eslint --prune-suppressions` to drop stale entries immediately.

---

## Part 5: Recommended Phased Execution Roadmap

1. **Phase 1 — Immediate Zero-Risk Quick Wins (1–2 days)**
    - **W14** (4 Shiki themes), **W2** (duplicate `webviewDidLaunch`), **W11** (`HistoryView` `forwardRef`), **W16** (`sourceMapInitializer`), **E10** (tree-sitter `tree.delete()` + cache), **E5** (OAuth negative cache), **E1** (lazy i18n), **E2** (lazy `tiktoken` + worker termination), **Z3** (dead `textMateToHljs`), **Z4** (`utils/logging`), **B5** (Vitest coverage glob & workflow test exclusions), and pruning stale `eslint-suppressions.json` / `knip.json` / `POSTHOG_API_KEY`.
2. **Phase 2 — Streaming & Webview Rendering Smoothness (3–5 days)**
    - **W5** & **W4** (`ChatRow` iframe/query/memoization fixes), **W6** (`CodeBlock` sticky positioning & single theme observer), **W7–W10** (`MarkdownBlock`, `ChatView` `LRUCache`/input isolation, `FileChangesPanel`, `Fzf` cache), **W12** (`SettingsView` search index), **W15** (lazy-load `MermaidBlock` & secondary views), and **E6** (replace 38 full `postStateToWebview()` calls).
3. **Phase 3 — Standalone Cleanup & VSIX Diet (3–5 days)**
    - **B1** (prune 7 unused tree-sitter WASMs — 10.17 MB), **B3** (dedupe `assets/marketplace` & `tiktoken_bg.wasm`, gate sourcemaps), **Z1–Z2** (remove `@roo-code/cloud` & decide on `@roo-code/telemetry`), **Z5–Z14** (dead files/configs/scripts/CSS), orphaned i18n key cleanup, and **B4** (`catalog:` + `openai` devDep).
4. **Phase 4 — Structural Performance Refactors (1–2 weeks)**
    - **W1** (split monolithic `ExtensionStateContext`), **E7** (incremental `taskMetadata` & coalesced message persistence), **E4** (consolidated/lazy `SecretStorage`), **B2** (`esbuild-wasm` 13 MB strategy), and `webview-ui` library consolidation (`react-remark`, `react-icons`, `styled-components`, `vscrui`).
