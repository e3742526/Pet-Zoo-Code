# Workflow / Dataflow / Process Audit (code-only, 2026-11-28)

Scope: UI entry points (buttons/inputs) in `webview-ui/src`, the
webview-to-extension message protocol in
`packages/types/src/vscode-extension-host.ts`, the backend dispatcher in
`src/core/webview/webviewMessageHandler.ts` (161 `case` branches), the
`WebviewFocusTracker` / `ClineProvider` alternate receivers, the
extension-to-webview protocol (`ExtensionMessage`), and the terminal
state of each backend process.

Method (no logs, no skills, code only):

- Enumerated `case "<type>"` branches in `webviewMessageHandler.ts`.
- Extracted true webview sends by matching `vscode.postMessage({ ... })`
  and the `postDraft({ type: ... })` wrapper in `ChatView.tsx`, excluding
  `__tests__` / `*.spec.*`.
- Cross-checked each direction; inspected handler bodies with `sed` for
  terminal responses (`postMessageToWebview`, `postStateToWebview*`,
  `vscode.window.*Message`).
- Checked extension-to-webview consumers by grepping `webview-ui/src`
  for each `ExtensionMessage` type.

Related code locations are given as `path:line` where read.

## 1. Buttons and inputs: coverage

The primary process-starting controls all reach the backend:

- Chat send / stop / enqueue: `ChatTextArea.tsx:1376-1394`
  (`onClick={isStreaming ? onStop : onSend}`), wired through
  `ChatView.tsx:678` (`postDraft`/spread postMessage), `:730-767`
  (`newTask`, `askResponse`), `:813,1518` (`queueMessage`), `:800-925`
  (`clearTask`, `cancelTask`, `askResponse yes/no`,
  `terminalOperation continue/abort`).
- Task history actions: `TaskActions.tsx:46,65,85,90`
  (`exportCurrentTask`, `deleteTaskWithId`, `openDebugApiHistory`,
  `openDebugUiHistory`).
- Provider OAuth buttons: `KimiCode.tsx:100` (`kimiCodeSignIn`),
  `OpenAICodex.tsx:51` (`openAiCodexSignIn`),
  `OpenRouter.tsx:78` (`openRouterSignIn`).
- Settings Save path: `SettingsView` bulk `updateSettings`
  (`webviewMessageHandler.ts:807-984`) ending in `settingsSaveResult`
  when `requestId` is present.
- Message edit/delete confirmations: `App.tsx:262-304`
  (`deleteMessageConfirm`, `editMessageConfirm`).
- Diagnostics download: `ErrorRow.tsx:123`
  (`downloadErrorDiagnostics`).

Presentational `onClick` handlers with no backend call (expand/collapse,
copy, zoom, tab buttons — e.g. `Markdown.tsx`, `CodeAccordion.tsx`,
`ZoomControls.tsx`, `TabButton.tsx`, `IconButton.tsx`,
`ReasoningBlock.tsx`, `TodoListDisplay.tsx`, context-management rows,
history `RenameButton/CopyButton`, `WelcomeLanding.tsx`) are local UI
state only. They are not processes and correctly have no backend end.

## 2. Backend processes with no start (handler exists, UI never sends)

All counts below are references in `webview-ui/src` outside tests/specs.

| Handler case (`webviewMessageHandler.ts`)                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shareCurrentTask` (`:1016`)                                                                                                                       | Zero `postMessage`/`postDraft` senders in `webview-ui/src`; no Share control in `TaskHeader.tsx`/`TaskActions.tsx`. Handler itself only errors (`share_not_enabled`). Dead process, no success end.                                                                                                                                                                                                       |
| `dismissUpsell` / `getDismissedUpsells` (`:3882`, `:3907`)                                                                                         | Zero senders; zero consumers of the `dismissedUpsells` reply. Dead round trip.                                                                                                                                                                                                                                                                                                                            |
| `rooCloudSignIn`, `rooCloudSignOut`, `rooCloudManualUrl`, `cloudLandingPageSignIn`, `switchOrganization`, `clearCloudAuthSkipModel` (`:3011-3118`) | Zero senders each. Only the provider-scoped sign-ins (`openAiCodexSignIn`, `kimiCodeSignIn`, `openRouterSignIn`, …) have live buttons. Generic cloud-auth process is unreachable.                                                                                                                                                                                                                         |
| `taskSyncEnabled` (`:2082`)                                                                                                                        | Zero senders; handler only logs "Ignoring …". Dead.                                                                                                                                                                                                                                                                                                                                                       |
| `saveApiConfiguration` (`:2467`)                                                                                                                   | Zero senders; UI uses `upsertApiConfiguration` (`ChatView`/settings report 20 sends). Legacy single-save path is orphaned.                                                                                                                                                                                                                                                                                |
| `requestModes` (`:3614`), `requestRooModels` (`:1551`), `getListApiConfiguration` (`:2637`)                                                        | Zero senders each (`getListApiConfiguration` reply `listApiConfig` therefore never requested). `requestCommands`, `requestSkills`, `requestRules` are the live equivalents.                                                                                                                                                                                                                               |
| `moveSkill` (`:3636`), `openRulesDirectory` (`:3664`), `insertTextIntoTextarea` (`:3828`)                                                          | Zero senders each as webview-to-extension messages. Note `insertTextIntoTextarea` is consumed as an extension-to-webview message (`ChatTextArea.tsx:217`); the reverse direction case has no starter.                                                                                                                                                                                                     |
| `installMarketplaceItemWithParameters` (`:3570`)                                                                                                   | Zero senders. Live installs use `installMarketplaceItem`.                                                                                                                                                                                                                                                                                                                                                 |
| `updateTodoList` (`:2440`)                                                                                                                         | Zero `type: "updateTodoList"` message sends (4 UI hits are the _tool_ name in `ChatRow.tsx:117,140`, `chatRowMessages.ts:20`, `renderChatToolRow.tsx:66`). The handler writes `approvedTodoList` via `setPendingTodoList` (`UpdateTodoListTool.ts:170-172`), but the only writer/reader of `approvedTodoList` is the tool-approval flow itself (`:56-66`); the message path is an orphaned second writer. |
| `searchCommits` (`:2355`)                                                                                                                          | One sender (`ChatTextArea.tsx:301`) but fires only from the commit-message helper path; the sibling `searchFiles` flow is the maintained one. Low risk; noted for completeness.                                                                                                                                                                                                                           |
| `abandonSubtaskWithId` (`:1035`), `checkoutBranch` (`:4249`), `checkBranchWorktreeInclude` (`:4203`)                                               | Zero senders in `webview-ui/src`. Either future/CLI-only or dead UI paths.                                                                                                                                                                                                                                                                                                                                |
| `allowedCommands` (`:1910`), `deniedCommands` (`:1926`), `ttsEnabled` (`:2096`), `ttsSpeed` (`:2102`), `telemetrySetting` (`:2960`)                | The 2–3 UI hits for each name are `cachedState` field keys (`AutoApproveSettings.tsx:109,119`, `NotificationSettings.tsx:36,57`, `ExtensionStateContext.tsx:341`), sent inside the bulk `updateSettings` payload, not as these single-type messages. The single-type cases are shadowed legacy paths (dual-write risk, see §4).                                                                           |

Corrections to the naive diff (not issues):

- `queueMessage` looked dead under a `vscode.postMessage`-only scan but is
  live via the `postDraft({ type: "queueMessage" })` wrapper
  (`ChatView.tsx:673,716,813,1518`).
- `webviewDidFocus` is consumed by `WebviewFocusTracker.ts:53`, not the
  main switch.
- `diagnosticsResponse` is consumed by `ClineProvider.ts:2078`, not the
  main switch.
- `draggedImages` appears only as a commented-out union member
  (`webviewMessageHandler.ts:4308`); there is no live case and no sender,
  so drag-drop images have no dataflow at all unless handled elsewhere.

## 3. Processes with a start but no (or incomplete) end

1. `installMarketplaceItemWithParameters` (`:3570-3586`): on success only
   `console.log`s; on failure only `showErrorMessage`. Unlike
   `installMarketplaceItem` (`:3491-3520`) and
   `removeInstalledMarketplaceItem` (`:3521-3568`), it never posts
   `marketplaceInstallResult`, so a caller can never observe completion.
2. `enhancePrompt` (`:2279-2325`): every failure posts `enhancedPrompt`
   (empty), but when `message.text` is empty the handler falls through
   the `if (message.text)` guard and posts nothing. A caller awaiting
   `enhancedPrompt` waits forever on empty input.
3. `playTts` (`:2108-2116`): `void playTts(...)` is a floating promise
   with `onStart`/`onStop` callbacks posting `ttsStart`/`ttsStop`. A
   synthesis failure between call and callback leaves the UI in
   "playing" state with no terminal event. `stopTts` (`:2117`) posts
   nothing either, so stop is also unacknowledged.
4. Checkpoint restores (`:1816-1902`): on the 3 s `pWaitFor` timeout the
   handlers `return` after `showErrorMessage` without posting any
   webview message. The UI that opened `CheckpointRestoreDialog` gets no
   machine-readable end, and `provider.cancelTask()` has already run, so
   the timeout path also strands the user on a fresh empty task.
5. `getSystemPrompt` (`:2326-2341`) / `copySystemPrompt` (`:2342-…`):
   success posts `systemPrompt`; the `catch` path only logs and shows an
   error message — no terminal message, so the requester cannot
   distinguish failure from delay.
6. `askResponse` (`:758-771`), `queueMessage` (`:3849-3854`),
   `removeQueuedMessage`, `editQueuedMessage`, `terminalOperation`
   (`:985-989`), `cancelTask` (`:1903`), `cancelAutoApproval`
   (`:1906`), `customInstructions` (`:754`), `mode` (`:2179`),
   `updatePrompt` (`:2182`): fire-and-forget by design (no ack). This is
   acceptable for cancels but means a dropped `askResponse` (e.g. task
   already torn down — `?.handleWebviewAskResponse` no-ops on undefined
   task) is silent: the approval UI dismisses with no backend effect and
   no error.

## 4. Dataflow issues (dual writes, partial writes, unobserved writes)

1. Dual write paths for the same setting: `updateSettings` bulk
   (`:851-885`, writing through `contextProxy.setValue` plus
   `setTtsEnabled`/`setTtsSpeed`/VS Code configuration updates) versus
   the single-type cases (`allowedCommands`, `deniedCommands`,
   `ttsEnabled`, `ttsSpeed`, `telemetrySetting` with its own
   `telemetrySettingQueue` at `:113-120,684-697`). The single-type paths
   bypass the bulk path's validation/normalization (e.g. command-list
   filtering, `isInvalidDisplayValue`). If both paths ever run, last
   writer wins with different semantics.
2. `updateSettings` is explicitly non-transactional (`:808-811` comment):
   entries apply in order, a mid-list failure leaves earlier writes
   stored and later ones dropped, followed by a state refresh that can
   show a mixture the user never submitted. Documented as intentional
   for display settings, but it applies to the whole payload including
   API and terminal settings.
3. `switchTab` (`:3588-3603`) re-emits as `action: switchTab` and records
   telemetry (`captureTabShown`) for every message, including
   programmatic echoes — telemetry overcounts user-initiated tab views.
4. `shareTaskSuccess` (union member, producer commented at `:4306`, zero
   UI consumers) and `organizationSwitchResult` (posted by
   `switchOrganization`, zero UI consumers) are unobserved writes:
   the backend emits a result nobody renders.
5. `vsCodeLmApiAvailable` (protocol member) has zero producers and zero
   consumers found — a stale contract member.

## 5. Suggested next steps

- Remove or rewire the dead cases in §2 (starting with `shareCurrentTask`,
  the `rooCloud*` family, `dismissUpsell`/`getDismissedUpsells`,
  `installMarketplaceItemWithParameters`, `updateTodoList`,
  `saveApiConfiguration`, `requestModes`/`requestRooModels`/
  `getListApiConfiguration`), or delete them from the `WebviewMessage`
  union so the protocol matches the UI.
- Give every remaining process a terminal message: post a result for
  `installMarketplaceItemWithParameters`; post `enhancedPrompt` (empty)
  on empty input or reject empty input in the UI; post a failure for
  `getSystemPrompt`; post a checkpoint-restore result even on timeout.
- Await or `.catch` the `playTts` promise and post `ttsStop` on failure;
  acknowledge `stopTts` if any UI state depends on it.
- Collapse the single-type setting cases into `updateSettings` or make
  them call the same normalization helpers so the two paths cannot
  diverge.
- Confirm whether `abandonSubtaskWithId`, `checkoutBranch`,
  `checkBranchWorktreeInclude`, `insertTextIntoTextarea` (webview→ext
  direction), `moveSkill`, and `openRulesDirectory` are CLI/future use;
  if so, comment them as such at the `case` site, otherwise remove.
