# Modularity Assessment: `src/core/task-persistence/TaskHistoryStore.ts`

**Date:** 2026-11-24  
**Target File:** [TaskHistoryStore.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts) (`1,355` lines, `48,715` bytes)  
**Scope:** Analysis & modularization blueprint only (no code modified).

---

## 1. Current Architecture & Responsibilities

`TaskHistoryStore.ts` has **0** ESLint suppressions in `src/eslint-suppressions.json` and already delegates lifecycle transitions to [taskLifecycle.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task-persistence/taskLifecycle.ts) and delta merging to [taskStoreConcurrency.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task-persistence/taskStoreConcurrency.ts). However, the class still bundles **5 distinct responsibilities**:

1. **Core Cache, Non-Reentrant Write Lock & Per-Task File I/O (`95–354`, `811–834`, `901–942`, `1028–1044`, `1161–1354`):**
    - `cache`, `sortedCache`, `taskFileMtimes`, `withLock()` promise-chain serializer.
    - `get()`, `getAll()`, `getByWorkspace()`, `upsert()` / `upsertCore()`, `delete()`, `deleteMany()`, `invalidate()`, `invalidateAll()`, `atomicReadAndUpdate()`, `atomicUpdatePair()`, `clearPendingActionIfMatching()`.
2. **Delegation Crash-Recovery & Repair-Intent Journal (`40–65`, `463–804` — ~340 lines):**
    - `DelegationRepairIntent`, `reconcileDelegationState()` / `reconcileDelegationStateCore()`, `replayDelegationRepairIntent()`, `repairActiveDelegation()`, `applyDelegationRepairIntent()`, `readDelegationRepairIntent()`, `isDelegationRepairIntent()`, `writeDelegationRepairIntent()`, `removeDelegationRepairIntent()`, `quarantineDelegationRepairIntent()`, `isSafeTaskId()`, `isFileNotFoundError()`, `getDelegationRepairIntentPath()`.
3. **Auto-Title Compare-and-Set (`84`, `1052–1150` — ~100 lines):**
    - `AutoTitleDiskRead`, `setAutoTitleIfAbsent()`, `cacheAutoTitle()`, `settleSkippedAutoTitle()`, `readTaskFileForAutoTitle()`, `unreadableForAutoTitle()`.
4. **Disk Reconciliation, `fs.watch` & Periodic Polling (`364–438`, `949–1014` — ~140 lines):**
    - `reconcile()`, `startWatcher()`, `startPeriodicReconciliation()`.
5. **Legacy `globalState` Migration (`844–894` — ~50 lines):**
    - `migrateFromGlobalState()`.

---

## 2. Exact Dependency Map

### A. Inbound Consumers

| File                                                                                                                                                                                                                                                                                                                                                                  | Usage                                                                                                                                                                                                                                      | Impact if Modularized                                                                                                                               |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| [index.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task-persistence/index.ts)                                                                                                                                                                                                                                                                            | Barrel re-export of `TaskHistoryStore`                                                                                                                                                                                                     | **None.**                                                                                                                                           |
| [ClineProvider.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/webview/ClineProvider.ts)                                                                                                                                                                                                                                                                     | Owns `TaskHistoryStore` instance (`initialize`, `get`, `getAll`, `upsert`, `delete`, `deleteMany`, `atomicReadAndUpdate`, `atomicUpdatePair`, `setAutoTitleIfAbsent`, `clearPendingActionIfMatching`, `migrateFromGlobalState`, `dispose`) | **None** if `TaskHistoryStore` retains its public API.                                                                                              |
| [importLegacyTaskHistory.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task-persistence/importLegacyTaskHistory.ts)                                                                                                                                                                                                                                        | Imports/uses `TaskHistoryStore`                                                                                                                                                                                                            | **None** if public API is unchanged.                                                                                                                |
| **Test & Verification Suites (16+ files):** `TaskHistoryStore.spec.ts`, `TaskHistoryStore.crossInstance.spec.ts`, `TaskHistoryStore.deleteSemantics.spec.ts`, `TaskHistoryStore.realConcurrency.spec.ts`, `TaskHistoryStore.reconciliation.spec.ts`, `safeWriteJson.interruption.test.ts`, `ClineProvider.*.spec.ts`, `Task.*.spec.ts`, `restart-persistence.test.ts` | Instantiate `new TaskHistoryStore(dir, options)` and test public methods (note: `TaskHistoryStore.spec.ts` also inspects private fields/methods in places)                                                                                 | **Low/Medium** — keep `TaskHistoryStore` public methods and re-exports (`assertValidTransition`, `HistoryItemStatus`, `DeltaRejectedError`) intact. |
| [scripts/check-task-store-concurrency.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/scripts/check-task-store-concurrency.ts#L72)                                                                                                                                                                                                                                    | Models `setAutoTitleIfAbsent` and lifecycle concurrency                                                                                                                                                                                    | **None** (do not change `setAutoTitleIfAbsent` semantics without updating the model).                                                               |

### B. Outbound Dependencies

- **Node:** `fs/promises`, `fs`, `path`, `crypto`.
- **External & Workspace:** `fast-deep-equal`, `@roo-code/types` (`historyItemSchema`, `HistoryItem`).
- **Internal:** `GlobalFileNames`, `LOCK_STALE_MS` (`fileLock.ts`), `safeWriteJson`, `deleteJsonFile` / `recoverMissingJsonFile` (`jsonFileRecovery.ts`), `getErrorCode` / `readFileWithMissingRetry`, `getStorageBasePath`, `taskLifecycle.ts` (`assertValidTransition`, `settleRejectedCreateSubtaskAction`, `HistoryItemStatus`), `taskStoreConcurrency.ts` (`computeHistoryDelta`, `DeltaRejectedError`, `mergeHistoryDelta`).

---

## 3. Recommended Modularization Plan (Exact Steps)

Keep `TaskHistoryStore` in `src/core/task-persistence/TaskHistoryStore.ts` as the single lock-owning facade (`~650–700` lines), and extract pure/cohesive collaborators into `src/core/task-persistence/`:

1. **Step 1 — Extract Delegation Crash-Recovery (`delegationRepair.ts`):**
    - Move `DelegationRepairIntent`, `readDelegationRepairIntent`, `isDelegationRepairIntent`, `writeDelegationRepairIntent`, `removeDelegationRepairIntent`, `quarantineDelegationRepairIntent`, `isSafeTaskId`, `matchesDelegationRepairParentPreconditions`, `matchesDelegationRepairChildPreconditions`, and the pure repair-pass logic (`reconcileDelegationStateCore`, `replayDelegationRepairIntent`, `repairActiveDelegation`, `applyDelegationRepairIntent`) taking a typed `StoreRepairContext` (`cache`, `getTasksDir`, `writeTaskFile`, `upsertLocked`, `onWrite`, `getAll`).
2. **Step 2 — Extract Auto-Title Compare-and-Set (`taskAutoTitle.ts`):**
    - Move `AutoTitleDiskRead`, `readTaskFileForAutoTitle`, `settleSkippedAutoTitle`, `cacheAutoTitle`, and `setAutoTitleIfAbsent` core logic.
3. **Step 3 — Extract Legacy `globalState` Migration (`migrateTaskHistory.ts`):**
    - Move `migrateFromGlobalState` body (already runs inside `withLock`).
4. **Step 4 — Extract `fs.watch` & Periodic Reconciliation (`TaskHistoryWatcher.ts` or helper):**
    - Encapsulate `fsWatcher`, `reconcileTimer`, and `watchDebounce` so `dispose()` cleanly cancels all three timers/watchers.

---

## 4. What Needs to Be Fixed, Patched, or Preserved

### Bugs & Code-Quality Issues to Fix During Modularization

1. **Uncancelled `watchDebounce` Timer in `dispose()` (`955`, `973`):**
    - `watchDebounce` is a local `let` inside `startWatcher()` rather than a class field, so `dispose()` does not `clearTimeout(watchDebounce)`. Promoting it to a field (or extracting `TaskHistoryWatcher`) prevents post-dispose `reconcile()` calls.
2. **Duplicated `delete` / `deleteMany` Logic (`303–323` vs `332–354`):**
    - `delete(taskId)` duplicates the entire `deleteMany` loop body. Have `delete(taskId)` call `deleteMany([taskId])` (or share a private `deleteTaskFileEntry(taskId)` helper).
3. **Duplicated `isFileNotFoundError(error)` (`797–799`):**
    - Duplicates `getErrorCode(error) === "ENOENT"` already imported from `./readFileWithMissingRetry` (line 13) and used elsewhere in the same file.
4. **Do NOT Introduce `any`s:**
    - `TaskHistoryStore.ts` currently has **0** entries in `src/eslint-suppressions.json` (and `TaskHistoryStore.spec.ts` has 4). Keep all new modules at `0` `any`s.

### Invariants That MUST Be Preserved (Do Not Break)

1. **Non-Reentrant `withLock` Contract:**
    - `withLock` (`1320–1336`) is a promise chain—calling a `withLock`-acquiring method from inside `withLock` deadlocks. All extracted helpers that run inside `withLock` must be explicitly typed/named as `*Locked` and never re-enter `upsert`, `reconcile`, or `reconcileDelegationState`.
2. **`sortedCache` & `writeInProgress` Invariant (`199–206`, `1322–1328`):**
    - `withLock` clears `sortedCache` and sets `writeInProgress = true` so `getAll()` during a write does not cache an intermediate snapshot.
3. **Lifecycle & Concurrency Rules ([AGENTS.md](file:///Users/eric/Work/vscode/Pet-Zoo-Code/AGENTS.md)):**
    - Read `docs/architecture/task-lifecycle-model.md` before altering any status transition, delegation repair, or `clearPendingActionIfMatching` behavior; keep transitions routed through `taskLifecycle.ts` (`assertValidTransition`, `settleRejectedCreateSubtaskAction`).
4. **Re-Exports on `TaskHistoryStore.ts` (`18–19`):**
    - Keep `export { assertValidTransition, type HistoryItemStatus }` and `export { DeltaRejectedError }`.

---

## 5. Other Files Impacted

- **Zero changes required in [ClineProvider.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/webview/ClineProvider.ts), [index.ts](file:///Users/eric/Work/vscode/Pet-Zoo-Code/src/core/task-persistence/index.ts), or `apps/vscode-e2e/`** if `TaskHistoryStore` retains its public surface.
- **Required verification after modularization:**
    - `pnpm --dir src run check-types`
    - `pnpm --dir src exec vitest run src/core/task-persistence/__tests__/TaskHistoryStore*.spec.ts src/utils/__tests__/safeWriteJson.interruption.test.ts`
    - `pnpm lifecycle:model-check` (if any lifecycle/repair transition code is touched)
    - `pnpm --dir src exec eslint --prune-suppressions --max-warnings=0 core/task-persistence/TaskHistoryStore.ts`
