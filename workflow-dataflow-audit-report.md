# Workflow, Dataflow, and Process Audit Report

**Scope:** Code-only static audit of `src/`, `webview-ui/src/`, `apps/cli/src/`, and `packages/`.  
**Goal:** Verify that every button, input, command, and flag starts a real process, that every process has a valid end and cleanup path, and that all wired processes are used.

---

## Executive Summary

| Severity | Count | Key Themes                                                                                                                                                                                                                                                        |
| -------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     |    10 | Broken settings persistence round-trips, hanging CLI retry/ask flows, permanently disposed MCP singleton, unused `runState` transitions, wrong CLI config namespace, Commander defaults shadowing settings, dropped TUI flags, missing disposal on `deactivate()` |
| Medium   |    12 | No-op UI button on images, dropped images on checkpoint edit, unhandled `draggedImages` drop event, dropped `indexCleared` responses, `SettingsView` live-state bypasses, broken worktree auto-open, watcher/timer leaks, unwired VS Code setting                 |
| Low      |     6 | 20 dead `webviewMessageHandler` cases, unused `SelectDropdown` component, native MCP image-only feedback drop, minor CLI/extension dead code                                                                                                                      |

---

## 1. Broken User-Facing Workflows, Buttons, and Inputs

### 1.1 `terminalOutputPreviewSize` has a broken round-trip and is ignored at runtime [High]

- **Locations:**
    - `webview-ui/src/components/settings/TerminalSettings.tsx:127-135`
    - `webview-ui/src/components/settings/SettingsView.tsx:253, 456, 1029`
    - `src/core/webview/ClineProvider.ts:3222-3514` (`getStateToPostToWebview`), `3515-3677` (`getState`)
    - `src/core/tools/ExecuteCommandTool.ts:456-458`
- **Issue:** `TerminalSettings` edits `terminalOutputPreviewSize` in `cachedState`, and `SettingsView.handleSubmit()` persists it through `updateSettings`. However, `ClineProvider.getState()` and `ClineProvider.getStateToPostToWebview()` never read or return `terminalOutputPreviewSize`.
- **Impact:**
    1. `ExecuteCommandTool.ts:457-458` reads `providerState?.terminalOutputPreviewSize ?? DEFAULT_TERMINAL_OUTPUT_PREVIEW_SIZE`, which always evaluates to the default (`"medium"`).
    2. After save or reload, the UI dropdown reverts to `"medium"`.

### 1.2 `showWorktreesInHomeScreen` never hydrates from storage, bypasses `cachedState`, and double-fires on click [High]

- **Locations:**
    - `webview-ui/src/components/worktrees/WorktreesView.tsx:18, 126-133, 185-190`
    - `webview-ui/src/components/ui/toggle-switch.tsx:50`
    - `webview-ui/src/context/ExtensionStateContext.tsx:899-901`
    - `src/core/webview/ClineProvider.ts:3222-3677` (`getStateToPostToWebview`, `getState`)
- **Issue:**
    1. **Broken round-trip:** `WorktreesView` persists `showWorktreesInHomeScreen` via `updateSettings`, but `ClineProvider.getState()` and `getStateToPostToWebview()` never read or return it. On state refresh or reload, `ExtensionStateContext.tsx:899` (`state.showWorktreesInHomeScreen ?? true`) reverts a saved `false` back to `true`.
    2. **Double-fire:** Both `<label onClick={handleToggleShowInHomeScreen}>` (`WorktreesView.tsx:187`) and `<ToggleSwitch onChange={handleToggleShowInHomeScreen} />` (`WorktreesView.tsx:188`) invoke the same handler, and `ToggleSwitch`'s `onClick` (`toggle-switch.tsx:50`) does not call `e.stopPropagation()`. Clicking the switch fires the handler twice and posts two `updateSettings` messages.
    3. **Bypasses `cachedState`:** Rendered inside `SettingsView`, but mutates live `useExtensionState()` and posts immediately instead of using `cachedState`.

### 1.3 Editing a message with a checkpoint silently drops attached images [Medium]

- **Locations:**
    - `webview-ui/src/App.tsx:282-298` (vs. `299-312`)
    - `src/core/webview/webviewMessageHandler.ts:2619-2635`
- **Issue:** When `editMessageDialogState.hasCheckpoint` is `true`, `MemoizedCheckpointRestoreDialog`'s `onConfirm` posts `{ type: "editMessageConfirm", messageTs, text, restoreCheckpoint }` without `images: editMessageDialogState.images`. The non-checkpoint branch (`App.tsx:307`) includes `images`, and `webviewMessageHandler.ts:2625` expects `message.images`.
- **Impact:** Editing a message that has images when a checkpoint is present silently discards all images.

### 1.4 Visible no-op "View Code" button on rendered images [Medium]

- **Locations:**
    - `webview-ui/src/components/common/ImageViewer.tsx:227-233` (also line `245`)
    - `webview-ui/src/components/common/MermaidActionButtons.tsx:67-75`
- **Issue:** `ImageViewer` passes `onViewCode={() => {}} // Not applicable for images` to `MermaidActionButtons`, which unconditionally renders the "View Code" `<IconButton icon="code" />`. (Line `245` also passes `onClick={() => {}}` to the sole active `TabButton` in the image modal.)
- **Impact:** Hovering over any image displays a clickable "View Code" button that starts no process.

### 1.5 Dropping images onto `ChatTextArea` posts an unhandled `draggedImages` message [Medium]

- **Locations:**
    - `webview-ui/src/components/chat/ChatTextArea.tsx:979-981`
    - `src/core/webview/webviewMessageHandler.ts:4308`
- **Issue:** Dropping image files onto `ChatTextArea` posts `vscode.postMessage({ type: "draggedImages", dataUrls })`. `webviewMessageHandler.ts` has no `case "draggedImages"` handler (it is listed in the commented-out "Currently unhandled" list at line `4308`).
- **Impact:** The extension silently drops the message instead of processing it.

### 1.6 `CodeIndexPopover` ignores `indexCleared` response messages [Medium]

- **Locations:**
    - `webview-ui/src/components/chat/CodeIndexPopover.tsx:1725`
    - `src/core/webview/webviewMessageHandler.ts:3452-3474`
- **Issue:** Clicking the clear-index button posts `{ type: "clearIndexData" }`. The extension responds with `{ type: "indexCleared", values: { success, error? } }`, but no listener in `webview-ui/src/` handles `indexCleared`.
- **Impact:** Clear-index failures and error messages returned by the extension are silently lost.

### 1.7 `PromptsSettings` persists literal sentinel `"-"` for `enhancementApiConfigId` and bypasses `cachedState` [Medium]

- **Locations:**
    - `webview-ui/src/components/settings/PromptsSettings.tsx:48-49, 172-181`
    - `src/core/webview/webviewMessageHandler.ts:2270-2273`
- **Issue:** Unlike `taskTitleApiConfigId` in the same file (`PromptsSettings.tsx:284-285`), `enhancementApiConfigId` reads/writes live `useExtensionState()` and posts `{ type: "enhancementApiConfigId", text: value }` immediately. When the user selects "Use current config" (`value === "-"`), local state receives `newConfigId` (`""`), but `postMessage` sends `text: value` (`"-"`), persisting `"-"` instead of `""`.

### 1.8 `AutoApproveSettings` and `ModesView` bypass `SettingsView` `cachedState` [Medium]

- **Locations:**
    - `webview-ui/src/components/settings/AutoApproveSettings.tsx:98-102, 131-138`
    - `webview-ui/src/hooks/useAutoApprovalToggles.ts:8-40`
    - `webview-ui/src/components/modes/ModesView.tsx:62-71`
    - `webview-ui/src/components/settings/SettingsView.tsx:1046`
- **Issue:**
    1. `AutoApproveSettings` reads/writes `autoApprovalEnabled` via live `useExtensionState()` and immediately posts `{ type: "autoApprovalEnabled" }`. It also calls `useAutoApprovalToggles()`, which reads live `alwaysAllow*` booleans instead of the buffered `cachedState` props, so `effectiveAutoApprovalEnabled` reflects stale saved permissions rather than unsaved edits in the form.
    2. `ModesView` (rendered as the `modes` tab inside `SettingsView`) mutates `customInstructions`, `mode`, `customModePrompts`, and `customModes` directly through `useExtensionState()` and immediate `postMessage` calls, bypassing `cachedState`.

---

## 2. Process Lifecycle and Termination Issues

### 2.1 Disposing the last `ClineProvider` leaves `McpServerManager.instance` pointing to a permanently disposed `McpHub` [High]

- **Locations:**
    - `src/core/webview/ClineProvider.ts:569-573, 1114, 1129`
    - `src/services/mcp/McpHub.ts:153-160, 1949-2005`
    - `src/services/mcp/McpServerManager.ts:21-28, 62-64`
- **Issue:** When the last `ClineProvider` disposes, `ClineProvider.dispose()` calls `this.mcpHub?.unregisterClient()`, which decrements `refCount` to `<= 0` and disposes `McpHub` (`isDisposed = true`, closing all connections and watchers). `McpServerManager.unregisterProvider(this)` removes the provider from `this.providers` but never clears `McpServerManager.instance`. Any subsequent `ClineProvider` calling `McpServerManager.getInstance(...)` receives the disposed `McpHub`.
- **Impact:** MCP stops working for the rest of the VS Code session after all panels/views close and a new one opens.

### 2.2 Async initialization races in `ClineProvider` MCP registration and `McpServerManager.cleanup()` [Medium]

- **Locations:**
    - `src/core/webview/ClineProvider.ts:569-576`
    - `src/services/mcp/McpServerManager.ts:36-53, 80-87`
- **Issue:**
    1. `ClineProvider` constructor attaches `McpServerManager.getInstance(...).then((hub) => { this.mcpHub = hub; this.mcpHub.registerClient() })` without checking `this._disposed`. If `dispose()` runs before `getInstance()` resolves, `unregisterClient()` is skipped and `refCount` is later incremented with no matching unregister.
    2. `McpServerManager.cleanup()` only disposes `this.instance`. If `cleanup()` runs while `this.initializationPromise` is still awaiting `hub.waitUntilReady()`, `this.instance` is still `null`, so `cleanup()` returns without cancelling the in-flight hub, leaving live MCP child processes and watchers after deactivation.

### 2.3 `ClineProvider` instances and `IpcServer` are never disposed on `deactivate()` [High]

- **Locations:**
    - `src/extension.ts:200-209, 271, 326, 330-350`
    - `src/core/webview/ClineProvider.ts:1069-1130`
    - `src/extension/api.ts:77-81`
    - `packages/ipc/src/ipc-server.ts:31-43`
- **Issue:**
    1. `activate()` creates `ClineProvider` and pushes only the `registerWebviewViewProvider` disposable to `context.subscriptions`, which unregisters the provider without calling `provider.dispose()`. `deactivate()` does not dispose `ClineProvider.getAllInstances()`, so unresolved sidebar providers and tab providers skip `ClineProvider.dispose()` (which stops watchdogs, interrupts delegated tasks, stops `nativeAgentController`, and disposes managers/watchers).
    2. When `PET_ZOO_CODE_IPC_SOCKET_PATH` is set, `API` starts `new IpcServer(socketPath, this.log)` and calls `ipc.listen()`. Neither `API` nor `IpcServer` has a `stop()`/`close()`/`dispose()` method, and `deactivate()` never closes the IPC socket.

### 2.4 13 of 18 `RunEvent` transitions in `runState.ts` are never dispatched in production [High]

- **Locations:**
    - `src/core/task/run-state/runState.ts:15-21, 40-58, 87-158`
    - `src/core/task/Task.ts:3560-3585, 3865-3866, 4238, 4252, 4295, 4879`
    - `src/core/task/run-state/runStateDivergence.ts:18`
- **Issue:**
    1. Six `Task` wrapper methods (`markStreamStarted`, `markStreamCleanupFinished`, `markStreamEnded`, `markAskStarted`, `markAskSettled`, `markCompletionAccepted`) have zero non-test callers. `Task` instead mutates `this.isStreaming` and `this.didFinishAbortingStream` directly, leaving `runState.stream` and `runState.ask` stuck at `{ tag: "none" }`, `generation` at `0`, and `phase` never reaching `"completed"`.
    2. Seven additional `RunEvent` variants (`turnStarted`, `firstChunkAwaitStarted`, `firstChunkAwaitEnded`, `toolRejected`, `toolUsed`, `toolFailed`, `streamReadCompleted`) have no `Task` wrappers and zero production references, leaving `runState.turn` permanently at `initialTurn`.
    3. Because `ROUTED_FIELDS` (`runStateDivergence.ts:18`) checks only `["abandoned", "isInitialized"]`, divergence tracking never flags this drift.

### 2.5 `CodeIndexManager` leaks watchers and in-flight scans during error recovery and service recreation [Medium]

- **Locations:**
    - `src/services/code-index/manager.ts:271-296, 354-366`
    - `src/services/code-index/orchestrator.ts:226-247`
- **Issue:**
    1. `recoverFromError()` (`manager.ts:285-292`) clears `this._orchestrator = undefined` and `this._sembleProvider = undefined` without calling `stopIndexing()` or `dispose()`, leaking active `FileSystemWatcher` instances and subscriptions.
    2. `_recreateServices()` (`manager.ts:356-358`) calls `stopWatcher()` instead of `stopIndexing()`. `stopWatcher()` does not abort `this._abortController`, so an active initial scan continues running on the replaced orchestrator.

### 2.6 Untracked timers, animation frames, and async effects without cleanup [Medium]

- **Locations:**
    - `src/core/webview/ClineProvider.ts:1741-1772` (`createTaskWithHistoryItem`)
    - `webview-ui/src/components/common/DiffView.tsx:108-143`
    - `webview-ui/src/components/chat/ModeSelector.tsx:176-205`
    - `webview-ui/src/components/worktrees/WorktreesView.tsx:110-113`
- **Issue:**
    1. `ClineProvider.createTaskWithHistoryItem` schedules an untracked `setTimeout(..., 100)` that calls `task.overwriteClineMessages`, `task.overwriteApiConversationHistory`, and `task.handleWebviewAskResponse` without checking `this._disposed`, `task.abort`, or whether `task` is still active.
    2. `DiffView` launches an async `processHunks` loop in `useEffect` without a cancellation flag or cleanup function; rapid prop changes can resolve out of order and overwrite newer hunks with stale results.
    3. `ModeSelector` schedules `requestAnimationFrame(...)` inside `useEffect` without capturing the frame ID or calling `cancelAnimationFrame` on cleanup.
    4. `WorktreesView.handleCreateWorktreeInclude` schedules an untracked `setTimeout(..., 500)` that is not cleared on unmount or when `worktreeResult` arrives.

### 2.7 Non-interactive CLI stalls on `api_req_failed`, TUI stalls on non-`followup` asks, and CLI has unclean exit/EOF paths [High]

- **Locations:**
    - `apps/cli/src/agent/ask-dispatcher.ts:497-511`
    - `apps/cli/src/ui/hooks/useMessageHandlers.ts:208-264`
    - `src/core/task/Task.ts:4857-4865`
    - `apps/cli/src/commands/cli/run.ts:335-361`
    - `apps/cli/src/agent/prompt-manager.ts:103-132`
- **Issue:**
    1. **Print-mode hang on retry:** When `nonInteractive: true` and `exitOnError: false`, `AskDispatcher.handleApiFailedRetry` prints `"\n[retrying api request]"` and returns `{ handled: true }` without calling `this.sendApprovalResponse(true)`. `Task.ts:4861` blocks waiting for `askResponse`, hanging the process indefinitely.
    2. **TUI hang on asks:** In TUI mode (where `AskDispatcher` is disabled), `useMessageHandlers.handleAskMessage` (`useMessageHandlers.ts:208-264`) appends non-`followup` asks (`api_req_failed`, `mistake_limit_reached`, `auto_approval_max_req_reached`, etc.) as chat items and returns without setting `pendingAsk` or sending `askResponse`, stalling the task with no prompt.
    3. **Bypassed cleanup on error/SIGTERM:** `AskDispatcher.handleApiFailedRetry` (`ask-dispatcher.ts:502-505`) calls `process.exit(1)` directly when `exitOnError` is true, skipping `host.dispose()`. TUI mode (`run.ts:335-361`) registers no `SIGTERM` handler (unlike non-TUI mode at lines `526-529`), so `SIGTERM` exits without `host.dispose()`.
    4. **Stdin EOF hang:** `PromptManager.promptForInput` (`prompt-manager.ts:103-132`) never resolves or rejects its Promise if `rl.on("close")` fires on EOF before `rl.question` receives input.

---

## 3. Broken Extension Entry Points and CLI Option Wiring

### 3.1 `checkWorktreeAutoOpen` fails when the sidebar is not already visible [Medium]

- **Locations:**
    - `src/extension.ts:70-113` (line `100`)
    - `src/activate/registerCommands.ts:93-108`
- **Issue:** `checkWorktreeAutoOpen` tries to open the sidebar in a newly opened worktree window by executing `${Package.name}.plusButtonClicked`. However, `plusButtonClicked` calls `getVisibleProviderOrLog` → `ClineProvider.getVisibleInstance()`. When the sidebar is closed, `getVisibleInstance()` returns `undefined` and the command logs an error and returns without opening the view.

### 3.2 URI handler silently drops `/requesty` callback when sidebar is hidden [Medium]

- **Locations:**
    - `src/activate/handleUri.ts:12, 21-22`
- **Issue:** `handleUri` checks `const visibleProvider = ClineProvider.getVisibleInstance()` and returns immediately on `case "/requesty": if (!visibleProvider) return`. If the sidebar is not open when the deep link fires, the callback is dropped with no feedback.

### 3.3 VS Code configuration property `pet-zoo-code.vsCodeLmModelSelector` is never read [Medium]

- **Locations:**
    - `src/package.json:399-412`
- **Issue:** `pet-zoo-code.vsCodeLmModelSelector` is contributed in `contributes.configuration.properties`, but `vscode.workspace.getConfiguration(...).get("vsCodeLmModelSelector")` is never called anywhere in `src/`. Runtime code only reads `vsCodeLmModelSelector` from provider profile settings (`ProviderSettings`).

### 3.4 CLI injects runtime settings under `"zoo-code"` instead of `"pet-zoo-code"` [High]

- **Locations:**
    - `apps/cli/src/agent/extension-host.ts:450`
    - `packages/vscode-shim/src/api/WorkspaceConfiguration.ts:27-30, 92-99`
    - `src/package.json:2`
- **Issue:** `ExtensionHost.markWebviewReady()` calls `setRuntimeConfigValues("zoo-code", this.initialSettings as Record<string, unknown>)`, storing keys under `"zoo-code.<key>"`. The extension reads settings via `vscode.workspace.getConfiguration(Package.name)` where `Package.name` is `"pet-zoo-code"`.
- **Impact:** None of the CLI's runtime workspace configuration overrides (for example `commandExecutionTimeout: 300`) are visible to the extension.

### 3.5 Commander defaults shadow CLI settings-file values for `--model`, `--mode`, and `--reasoning-effort` [High]

- **Locations:**
    - `apps/cli/src/index.ts:39-46`
    - `apps/cli/src/commands/cli/run.ts:152-155`
- **Issue:** `index.ts` supplies `DEFAULT_FLAGS.*` directly as Commander option defaults. Because Commander always populates those defaults even when the user omits the flags, `flagOptions.mode`, `flagOptions.model`, and `flagOptions.reasoningEffort` are always truthy, making the fallback to `settings.mode`, `settings.model`, and `settings.reasoningEffort` in `run.ts:153-155` unreachable.

### 3.6 TUI mode silently drops `--consecutive-mistake-limit`, `--terminal-shell`, and `--exit-on-error` [High]

- **Locations:**
    - `apps/cli/src/commands/cli/run.ts:195-209, 341-349`
    - `apps/cli/src/ui/App.tsx:74-92, 176-194`
    - `apps/cli/src/ui/hooks/useExtensionHost.ts:65-83, 107-120`
- **Issue:** `run.ts` populates all three options in `extensionHostOptions` and passes them to `<App {...extensionHostOptions} />`, but both `AppInner` and `useExtensionHost` omit `consecutiveMistakeLimit`, `terminalShell`, and `exitOnError` when calling `createExtensionHost(...)`.

### 3.7 Minor CLI option and shortcut wiring issues [Low]

- **`list sessions` ignores declared flags:** `apps/cli/src/index.ts:68-74, 116` attaches `-e/--extension`, `-k/--api-key`, and `-d/--debug` via `applyListOptions`, but `listSessions` (`apps/cli/src/commands/cli/list.ts:308-319`) ignores all three.
- **Help menu inserts literal `"ctrl + m"`:** `createHelpTrigger` (`apps/cli/src/ui/components/autocomplete/triggers/HelpTrigger.tsx:26, 99-103`) omits `"mode"` (`ctrl + m`) from the action-shortcut list `["newline", "focus", "quit", "todos"]`, so selecting it from the `?` menu inserts the literal string `"ctrl + m"` into the prompt input instead of switching modes.

---

## 4. Dead or Unused Processes, Handlers, and Components

### 4.1 20 dead `webviewMessageHandler.ts` cases with no webview or CLI sender [Low]

- **Location:** `src/core/webview/webviewMessageHandler.ts`
- **Unreferenced handlers (zero senders in `webview-ui/src/` and `apps/cli/src/`):**
    - `abandonSubtaskWithId` (`L1035`)
    - `shareCurrentTask` (`L1016`)
    - `requestRooModels` (`L1551`)
    - `taskSyncEnabled` (`L2082`)
    - `saveApiConfiguration` (`L2467`)
    - `getListApiConfiguration` (`L2637`)
    - `telemetrySetting` (`L2960`)
    - `rooCloudSignIn`, `cloudLandingPageSignIn`, `rooCloudManualUrl`, `rooCloudSignOut` (`L3011-3019` — comment notes legacy compatibility; `rooCloudSignOut` also posts `authenticatedUser`, which has no webview listener)
    - `clearCloudAuthSkipModel` (`L3101`)
    - `switchOrganization` (`L3107` — posts `organizationSwitchResult`, which has no webview listener)
    - `installMarketplaceItemWithParameters` (`L3570`)
    - `moveSkill` (`L3636`)
    - `openRulesDirectory` (`L3664`)
    - `dismissUpsell` (`L3882`) and `getDismissedUpsells` (`L3907` — both post `dismissedUpsells`, which has no webview listener)
    - `checkBranchWorktreeInclude` (`L4203` — posts `branchWorktreeIncludeResult`, which has no webview listener)
    - `checkoutBranch` (`L4249`)

### 4.2 Unused UI component `SelectDropdown` [Low]

- **Locations:** `webview-ui/src/components/ui/select-dropdown.tsx:44-311`, `webview-ui/src/components/ui/index.ts:18`
- **Issue:** Exported from `components/ui/index.ts`, with zero production consumers in `webview-ui/src/` (referenced only in its own spec file).

### 4.3 Native MCP approval drops image-only feedback [Low]

- **Location:** `src/core/assistant-message/presentMcpToolUse.ts:144, 158`
- **Issue:** Both the denial branch (`L144`) and approval branch (`L158`) check `if (text)` instead of `if (text || images?.length)` (unlike `presentAssistantMessage.ts:388, 392, 409, 412`). Image-only feedback on native MCP approvals/denials is silently dropped.

### 4.4 Minor dead code and sentinel leakage [Low]

- **Dead `userInput` variable:** `src/activate/registerCodeActions.ts:24, 60` declares `let userInput: string | undefined` without ever assigning it; `...(userInput ? { userInput } : {})` is always omitted.
- **Telemetry sentinels in `toolNames`:** `packages/types/src/tool.ts:48-49` includes `"custom_tool"` and `"invalid_tool_call"` in `toolNames`, so `isValidToolName` (`src/core/tools/validateToolUse.ts:14-18`) and `NativeToolCallParser.parseToolCall` (`src/core/assistant-message/NativeToolCallParser.ts:769`) treat them as known static tool names (they are still rejected later by mode/group filtering).

---

## 5. Verified Healthy Areas

The following workflows and boundaries were audited and confirmed complete end-to-end:

- **VS Code command registrations:** All 25 commands in `src/package.json` (`contributes.commands`, `menus`, `keybindings`) are registered and mapped to handlers. Both internal commands (`pet-zoo-code.activationCompleted`, `pet-zoo-code.focusPanel`) are actively invoked.
- **VS Code configuration properties:** 20 of 21 properties in `src/package.json` are read and used at runtime (only `pet-zoo-code.vsCodeLmModelSelector` is unwired).
- **SettingsView draft submission:** All 61 `setCachedStateField` keys across `webview-ui/src/components/settings/` are included in `SettingsView.handleSubmit()`.
- **Settings search index:** All 59 `settingId` entries and visibility predicates in `settingsSearchIndex.ts` match rendered `SearchableSetting` components.
- **Native tool execution pipeline:** All 23 executable tools (plus aliases `search_and_replace` -> `edit`, `write_file` -> `write_to_file`, and dynamic `mcp--*`) are wired through `build-tools.ts`, `NativeToolCallParser.ts`, `dispatchToolUse.ts`, `describeToolUse.ts`, and `src/core/tools/`. No unused tool implementation files exist.
- **Persisted task lifecycle & native agent processes:** All 12 exports in `src/core/task-persistence/taskLifecycle.ts` are called in production. `Task.ask()` properly exits on `abort` and clears timers in `finally`. `Task.disposeOnce()` cleans up intervals, timers, queues, and trackers. `NativeAgentController` tears down process groups, RPC transports, and timers in `stop()`.
