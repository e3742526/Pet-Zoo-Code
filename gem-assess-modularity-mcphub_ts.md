# Modularity Assessment: `src/services/mcp/McpHub.ts`

**Date:** 2026-11-24  
**Target File:** [McpHub.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/services/mcp/McpHub.ts) (`2,594` lines, `89,880` bytes)  
**Scope:** Analysis & modularization blueprint only (no code modified).

---

## 1. Current Architecture & Responsibilities

`src/services/mcp/McpHub.ts` is an `89.9 KB` god-class that combines **8 distinct subsystems**:

1. **Public Types & Zod Schemas (`49–165`):**
    - `ConnectedMcpConnection`, `DisconnectedMcpConnection`, `McpConnection`, `DisableReason`, `ServerConfigSchema`, `McpSettingsSchema`.
2. **Lifecycle, Reference Counting & Event Bus (`167–251`, `2489–2593`):**
    - `serverListEvents` (`onServerListChanged`), `registerClient()` / `unregisterClient()`, `waitUntilReady()`, `handleMcpEnabledChange()`, `dispose()`.
3. **Config File Watching, Debouncing & Persistence (`329–673`, `2024–2239`, `2368–2448`):**
    - Global (`mcp_settings.json`) and project (`.roo/mcp.json`) `vscode.FileSystemWatcher`s, workspace folder change listener, 500ms debounce, `isProgrammaticUpdate` suppression flag, `safeWriteJson` writes, and duplicated config-path resolution across 5 methods.
4. **Config Validation (`253–318`):**
    - `validateServerConfig()` (mixed stdio/url detection, type inference, Zod error formatting).
5. **Transport & Server Connection Factory (`718–1088` — `370` lines in one method):**
    - `connectToServer()`: `injectVariables`, Windows `cmd.exe` wrapping + `stderr` capture + `transport.start` monkey-patch for `stdio`; `ReconnectingEventSource` + `global.EventSource` override for `sse`; `McpOAuthClientProvider` discovery + client pre-registration + `UnauthorizedError` 401 re-auth for `streamable-http`.
6. **OAuth Browser Flow & Cross-Window Token Watcher (`1105–1420`):**
    - `_initiateOAuthFlow()`, `_runOAuthFlow()`, `_completeOAuthFlow()` (`withProgress`, toast notification, `_oauthWatchers`, `reauthPromises`, `SecretStorageService` cross-window `onDidChange`).
7. **Per-Server Chokidar File Watchers (`1712–1786`):**
    - `setupFileWatcher()`, `removeAllFileWatchers()`, `removeFileWatchersForServer()` for `watchPaths` and `build/index.js`.
8. **MCP Protocol Operations & Webview Sync (`1482–1596`, `1881–2016`, `2241–2357`, `2450–2482`):**
    - `findServerNameBySanitizedName()`, `fetchToolsList()`, `fetchResourcesList()`, `fetchResourceTemplatesList()`, `readResource()`, `callTool()` (with 401 retry), `toggleToolAlwaysAllow()`, `toggleToolEnabledForPrompt()`, `toggleServerDisabled()`, `updateServerTimeout()`, `deleteServer()`, `notifyWebviewOfServerChanges()`.

---

## 2. Exact Dependency Map

### A. Inbound Consumers (Who Imports / Calls `McpHub`)

- **Lifecycle Owner:** [McpServerManager.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/services/mcp/McpServerManager.ts#L2) (`new McpHub(provider, secretStorage)`).
- **Tool & Prompt Consumers (11 production files):**
    - [ToolRouter.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/services/tools/ToolRouter.ts#L3) (`Pick<McpHub, "onServerListChanged">`)
    - [UseMcpToolTool.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/tools/UseMcpToolTool.ts) (`callTool`, `findServerNameBySanitizedName`)
    - [accessMcpResourceTool.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/tools/accessMcpResourceTool.ts) (`readResource`)
    - [presentAssistantMessage.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/assistant-message/presentAssistantMessage.ts) (`findServerNameBySanitizedName`)
    - [Task.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task/Task.ts), [build-tools.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task/build-tools.ts)
    - [system.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/prompts/system.ts), [effective-tool-policy.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/prompts/tools/effective-tool-policy.ts), [filter-tools-for-mode.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/prompts/tools/filter-tools-for-mode.ts), [mcp_server.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/prompts/tools/native-tools/mcp_server.ts)
    - [ClineProvider.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/webview/ClineProvider.ts), [generateSystemPrompt.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/webview/generateSystemPrompt.ts), [webviewMessageHandler.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/webview/webviewMessageHandler.ts)
- **Test & CI Contract Files (20+ files):**
    - [McpHub.spec.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/services/mcp/__tests__/McpHub.spec.ts) (**2,900+ lines**, `150` `@typescript-eslint/no-explicit-any` suppressions)
    - [McpHub.settingsCreation.integration.spec.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/services/mcp/__tests__/McpHub.settingsCreation.integration.spec.ts)
    - [ToolRouter.integration.spec.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/services/tools/__tests__/ToolRouter.integration.spec.ts)
    - [verify-coverage-cache-inputs.mjs](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/scripts/verify-coverage-cache-inputs.mjs#L32) & [verify-coverage-contract.mjs](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/scripts/verify-coverage-contract.mjs#L67) — `McpHub.spec.ts` is the **pinned coverage anchor** for `services`.

### B. Outbound Dependencies

- **External:** `vscode`, `@modelcontextprotocol/sdk` (`Client`, `StdioClientTransport`, `SSEClientTransport`, `StreamableHTTPClientTransport`, `UnauthorizedError`, schemas), `reconnecting-eventsource`, `chokidar`, `delay`, `fast-deep-equal`, `zod`.
- **Internal:** `@roo-code/types`, `ClineProvider` (via `WeakRef`), `ToolRouter.getInstance()`, `McpOAuthClientProvider`, `SecretStorageService`, `safeWriteJson`, `injectVariables`, `sanitizeMcpName` / `toolNamesMatch`, `t` (`i18n`), `GlobalFileNames`, `fileExistsAtPath`, `arePathsEqual` / `getWorkspacePath`.

---

## 3. Recommended Modularization Plan (Exact Steps)

Keep `McpHub` in `src/services/mcp/McpHub.ts` as the **public facade** preserving its constructor and all 19 public methods/properties (`connections`, `isConnecting`, `onServerListChanged`, `waitUntilReady`, `registerClient`, `unregisterClient`, `getServers`, `getAllServers`, `getMcpServersPath`, `getMcpSettingsFilePath`, `findServerNameBySanitizedName`, `deleteConnection`, `updateServerConnections`, `restartConnection`, `refreshAllConnections`, `readResource`, `callTool`, `toggleToolAlwaysAllow`, `toggleToolEnabledForPrompt`, `handleMcpEnabledChange`, `toggleServerDisabled`, `updateServerTimeout`, `deleteServer`, `dispose`), plus re-exported types (`ConnectedMcpConnection`, `DisconnectedMcpConnection`, `McpConnection`, `DisableReason`, `ServerConfigSchema`):

1. **Step 1 — Extract Schemas, Types & Config Validation (`mcpConfigSchema.ts`):**
    - Move `ConnectedMcpConnection`, `DisconnectedMcpConnection`, `McpConnection`, `DisableReason`, `BaseConfigSchema`, `ServerConfigSchema`, `McpSettingsSchema`, and `validateServerConfig()` into `mcpConfigSchema.ts` (re-export from `McpHub.ts`).
2. **Step 2 — Extract Config Store & File Watchers (`McpConfigStore.ts`):**
    - Consolidate the 5 duplicated `global` vs `project` path/read/write blocks (`getMcpSettingsFilePath`, `getProjectMcpPath`, `readServerConfigFromFile`, `updateServerConfig`, `updateServerToolList`, `deleteServer`) and `vscode.FileSystemWatcher` + 500ms debounce + `chokidar` per-server `watchPaths` into a dedicated store/watcher helper.
3. **Step 3 — Extract Transport Factory (`mcpTransportFactory.ts`):**
    - Split `connectToServer()`'s 3 transport branches (`createStdioTransport`, `createSseTransport`, `createStreamableHttpTransport`) out of `McpHub.ts`.
4. **Step 4 — Extract OAuth Flow Coordinator (`McpOAuthCoordinator.ts`):**
    - Move `_initiateOAuthFlow()`, `_runOAuthFlow()`, `_completeOAuthFlow()`, `_oauthWatchers`, and `reauthPromises` into a dedicated class taking `secretStorage`, `findConnection`, `deleteConnection`, `connectToServer`, and `notifyWebviewOfServerChanges` callbacks.
5. **Step 5 — Extract Webview Sync & Capability Fetchers (`mcpCapabilities.ts` / `McpHub.ts`):**
    - Extract `fetchToolsList`, `fetchResourcesList`, `fetchResourceTemplatesList`, `appendErrorMessage`, and `notifyWebviewOfServerChanges` sorting/posting.

---

## 4. What Needs to Be Fixed, Patched, or Preserved

### Bugs & Code-Quality Issues to Fix During Modularization

1. **ESLint `@typescript-eslint/no-explicit-any` Suppressions (`7` in `McpHub.ts`, `150` in `McpHub.spec.ts`):**
    - Per [AGENTS.md](file:///Users/eric/Work/vscode/Pet-Zoo-Code/AGENTS.md), suppression counts in [src/eslint-suppressions.json](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/eslint-suppressions.json#L1157-L1175) must **never increase**, and new files/tests must have **zero** `any`s. Replace `config: any` / `Record<string, any>` / `(configInjected as any).type` / `error.code === "ENOENT"` (implicit `any`) with `unknown` + type guards, and run `pnpm --dir src exec eslint --prune-suppressions --max-warnings=0`.
2. **Global `EventSource` Mutation (`line 973`):**
    - `global.EventSource = ReconnectingEventSource` mutates Node's global scope on SSE connect. Isolate or restore if needed, and verify `SSEClientTransport` tests don't depend on the global side effect.
3. **Unscoped `isProgrammaticUpdate` Flag (`lines 199–200`, `2139`, `2433`):**
    - A single boolean suppresses _both_ `global` and `project` config watchers for 600ms. Scope it by source/file path (`Set<string>` or per-path timer) so programmatic writes to `mcp_settings.json` don't swallow `.roo/mcp.json` edits.
4. **`deleteServer` Missing Programmatic-Update Guard (`line 2226`):**
    - `deleteServer` calls `safeWriteJson` without setting `isProgrammaticUpdate` (unlike `updateServerConfig` and `updateServerToolList`), risking a redundant watcher-triggered `updateServerConnections` race.
5. **Duplicated Config Read/Write Boilerplate:**
    - Unify the 5 copies of `if (source === "project") getProjectMcpPath() else getMcpSettingsFilePath()` + `fs.access` + `JSON.parse`.

### Invariants That MUST Be Preserved (Do Not Break)

1. **Coverage Contract Anchor:** Do not delete, rename, or break [McpHub.spec.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/services/mcp/__tests__/McpHub.spec.ts) — it is hardcoded in `verify-coverage-cache-inputs.mjs` and `verify-coverage-contract.mjs`.
2. **`McpHub` Public Facade & `connections` Array:** `McpHub.spec.ts` and `ToolRouter.integration.spec.ts` instantiate `new McpHub(provider, secretStorage)` directly and inspect `mcpHub.connections` / private methods in unit tests; keep the public API identical and re-export `ServerConfigSchema`, `McpConnection`, `DisableReason`.
3. **OAuth Registration & TDZ Ordering (`lines 1266–1284`):** `_oauthWatchers.set(...)` MUST happen _before_ `cancellationToken.onCancellationRequested(...)` so synchronous cancellation on an already-cancelled token finds the watcher entry without hitting the `cancellationDisposable` TDZ.
4. **Stdio `transport.start` No-Op Patch (`lines 820, 1003–1005`):** Must remain `stdio`-only so `stderr` is captured before `client.connect(transport)` without breaking `SSE` or `StreamableHTTP` transports.
5. **Project-Over-Global Deduplication (`lines 498–516`, `1455–1472`, `1918–1935`):** Project servers must continue to override global servers of the same name.

---

## 5. Other Files Impacted

- **Zero changes required in `src/core/` or `apps/vscode-e2e/`** if `McpHub.ts` preserves its public facade and re-exports.
- **Required verification after modularization:**
    - `pnpm --dir src run check-types`
    - `pnpm --dir src exec vitest run src/services/mcp/__tests__/ src/services/tools/__tests__/ToolRouter.integration.spec.ts`
    - `pnpm --dir src exec eslint --prune-suppressions --max-warnings=0 services/mcp/McpHub.ts` (and any newly created files)
    - `node src/scripts/verify-coverage-contract.mjs` (or `verify-coverage-cache-inputs.mjs`) to ensure the `services` coverage contract remains intact.
