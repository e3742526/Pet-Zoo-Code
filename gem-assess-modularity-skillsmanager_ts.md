# Modularity Assessment: `src/services/skills/SkillsManager.ts`

**Date:** 2026-11-24  
**Target File:** [SkillsManager.ts](src/services/skills/SkillsManager.ts) (`1,154` lines, `40,499` bytes)  
**Scope:** Analysis & modularization blueprint only (no code modified).

---

## 1. Current Architecture & Responsibilities

`src/services/skills/SkillsManager.ts` has **0** ESLint suppressions in `src/eslint-suppressions.json` and already separates invocation/mention helpers into [skillInvocation.ts](src/services/skills/skillInvocation.ts). However, `SkillsManager.ts` itself bundles **4 distinct subsystems**:

1. **Discovery & Symlink/Container Scanning (`25–60`, `102–393`, `973–1052` — ~400 lines):**
    - `DiscoveryPass` queue (`discoveryQueue`), `runDiscovery()`, `publishSkills()` (retains previously discovered skills under `failedPaths`), `scanSkillsDirectory()`, `scanSkillContainer()`, `isSymlink()`, `loadSkillMetadata()`, `getSkillsDirectories()`, `getAvailableModes()`, `getSkillKey()`.
2. **Mode Resolution & Querying (`401–529` — ~130 lines):**
    - `getSkillsForMode()`, `isSkillAvailableInMode()`, `shouldOverrideSkill()` (`project > global`, `mode-specific > generic`), `getAllSkills()`, `getSkillContent()`, `getSkillsMetadata()`, `getSkill()`, `findSkillByNameAndSource()`.
3. **Skill CRUD & Cross-Filesystem Move (`535–968` — ~435 lines):**
    - `createSkill()`, `deleteSkill()`, `moveSkill()`, `assertNotContainerSkill()`, `moveDirectory()` (`EXDEV` cross-device staging + `verbatimSymlinks` + rollback), `findEscapingRelativeSymlink()`, `updateSkillModes()`, `validateSkillName()`, `getSkillNameErrorMessage()`.
4. **VS Code File Watchers & Lifecycle (`71–85`, `1054–1153` — ~115 lines):**
    - `setupFileWatchers()`, `watchDirectory()`, `syncContainerWatchers()`, `createSkillsWatcher()`, `dispose()`.

---

## 2. Exact Dependency Map

### A. Inbound Consumers

| File                                                                                                                                                                                                                                                                                                                              | Usage                                                                                                                                  | Impact if Modularized                                                                                  |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| [ClineProvider.ts](src/core/webview/ClineProvider.ts#L112)                                                                                                                                                                                                                                                                        | Instantiates `new SkillsManager(this)` and exposes `getSkillsManager()`                                                                | **None** if `SkillsManager` keeps its constructor and public methods.                                  |
| [skillsMessageHandler.ts](src/core/webview/skillsMessageHandler.ts) & [webviewMessageHandler.ts](src/core/webview/webviewMessageHandler.ts)                                                                                                                                                                                       | Calls `createSkill`, `deleteSkill`, `moveSkill`, `updateSkillModes`, `getSkillsMetadata`, `findSkillByNameAndSource`, `discoverSkills` | **None.**                                                                                              |
| [system.ts](src/core/prompts/system.ts), [skills.ts](src/core/prompts/sections/skills.ts), [generateSystemPrompt.ts](src/core/webview/generateSystemPrompt.ts), [Task.ts](src/core/task/Task.ts)                                                                                                                                  | `getSkillsForMode` (`Pick<SkillsManager, "getSkillsForMode">`)                                                                         | **None.**                                                                                              |
| [SkillTool.ts](src/core/tools/SkillTool.ts), [RunSlashCommandTool.ts](src/core/tools/RunSlashCommandTool.ts), [mentions/index.ts](src/core/mentions/index.ts)                                                                                                                                                                     | Uses `SkillLookup` (`getSkillContent`, `getSkillsForMode`) via `skillInvocation.ts`                                                    | **None.**                                                                                              |
| **Test Suites:** [SkillsManager.spec.ts](src/services/skills/__tests__/SkillsManager.spec.ts) (`118 KB`), [ClineProvider.flicker-free-cancel.spec.ts](src/core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts#L243) (mocks `SkillsManager`), `skillsMessageHandler.spec.ts`, `skillTool.spec.ts`, `sections.spec.ts` | Instantiate/mock `SkillsManager`                                                                                                       | **None** if `SkillsManager.ts` retains its exports (`SkillsManager`, `SkillMetadata`, `SkillContent`). |

### B. Outbound Dependencies

- **Node & External:** `fs/promises`, `path`, `vscode`, `gray-matter`.
- **Internal:** `@roo-code/types` (`validateSkillName`, `SkillNameValidationError`, `SKILL_NAME_MAX_LENGTH`), `parseFrontmatter` (`safeFrontmatter.ts`), `ClineProvider` (type-only via `WeakRef`), `roo-config` (`getGlobalRooDirectory`, `getGlobalAgentsDirectory`, `getProjectAgentsDirectoryForCwd`, `directoryExists`, `fileExists`), `shared/skills`, `shared/modes`, `t` (`i18n`).

---

## 3. Recommended Modularization Plan (Exact Steps)

Keep `SkillsManager` in `src/services/skills/SkillsManager.ts` as the stateful facade (`~250–300` lines), and extract 3 focused modules into `src/services/skills/`:

1. **Step 1 — Extract Directory & Symlink Discovery (`skillDiscovery.ts`):**
    - Move `DiscoveryPass`, `isNotFoundError`, `isUnderAny`, `isHiddenEntry`, `scanSkillsDirectory`, `scanSkillContainer`, `loadSkillMetadata`, `getSkillsDirectories`, `getSkillKey`, and `publishSkills`.
2. **Step 2 — Extract Skill CRUD & Cross-Filesystem Move (`skillMutations.ts` + `skillDirectoryMove.ts`):**
    - Move `moveDirectory()` + `findEscapingRelativeSymlink()` (`~155` lines of self-contained EXDEV staging, symlink-escape verification, and trash rollback) into `skillDirectoryMove.ts`.
    - Move `createSkill`, `deleteSkill`, `moveSkill`, `updateSkillModes`, `validateSkillName`, and `getSkillNameErrorMessage` into `skillMutations.ts`.
3. **Step 3 — Extract Watcher Sync (`SkillsWatcher.ts`):**
    - Move `setupFileWatchers`, `watchDirectory`, `syncContainerWatchers`, `createSkillsWatcher`, and `SKILLS_WATCH_PATTERN` into `SkillsWatcher.ts`.
4. **Step 4 — Keep `SkillsManager.ts` as Facade + Mode Resolution:**
    - Retain `skills`, `containers`, `containerSkillPaths`, `discoveryQueue`, `getSkillsForMode`, `getSkillContent`, `getAllSkills`, `getSkill`, `findSkillByNameAndSource`, and delegation to the extracted modules.

---

## 4. What Needs to Be Fixed, Patched, or Preserved

### Bugs & Code-Quality Issues to Fix During Modularization

1. **Unsafe Manual YAML Frontmatter Serialization in `createSkill` (`615–625`):**
    - `createSkill` builds YAML by string interpolation (`` `description: ${trimmedDescription}` ``), which breaks if `trimmedDescription` contains `:`, `#`, quotes, or newlines. Use `matter.stringify` (matching `updateSkillModes` at line 963).
2. **Watcher Event Listener Disposables Not Tracked (`1136–1140`):**
    - `createSkillsWatcher` registers `watcher.onDidChange(onEvent)`, `onDidCreate(onEvent)`, and `onDidDelete(onEvent)` without wrapping them in `vscode.Disposable.from(watcher, ...)`, leaking the listener disposables when a container watcher is disposed.
3. **Duplicated `findSkillByNameAndSource` Loop (`933–939` vs `522–529`):**
    - `updateSkillModes` re-implements `this.findSkillByNameAndSource(name, source)` inline.
4. **Duplicated `baseDir` Resolution (`584–593` vs `697–706`):**
    - `createSkill` and `moveSkill` repeat the same `global` vs `project` `.roo` directory resolution and `no_workspace` error.

### Invariants That MUST Be Preserved (Do Not Break)

1. **Discovery Queue & Snapshot Atomicity (`95–152`):**
    - `discoveryQueue` serializes scans so an older pass cannot overwrite a newer one, and `publishSkills` preserves previously discovered skills/containers under `failedPaths` when a transient read error occurs.
2. **Collision & Override Precedence (`162–164`, `446–469`, `990–1025`):**
    - Direct skills beat container skills; alphabetically earlier containers beat later ones; `.roo` beats `.agents`; `project` beats `global`; mode-specific beats generic.
3. **Container Skill Read-Only Guard (`763–767`) & `.agents` Move Guard (`714–724`):**
    - Symlinked container skills cannot be deleted or moved; `.agents` skills cannot be moved by `moveSkill`.
4. **Zero ESLint Suppressions:** Keep `SkillsManager.ts` and all new modules at `0` `any`s.

---

## 5. Other Files Impacted

- **Zero changes required in `ClineProvider.ts`, `skillsMessageHandler.ts`, `SkillTool.ts`, or `mentions/`** if `SkillsManager.ts` retains its public API and type re-exports.
- **Note on [skillsTestHarness.ts](src/services/skills/__tests__/skillsTestHarness.ts#L3):** Keep `vi.mock` calls in `SkillsManager.spec.ts` (not moved into the harness).
- **Required verification after modularization:**
    - `pnpm --dir src run check-types`
    - `pnpm --dir src exec vitest run src/services/skills/__tests__/ src/core/webview/__tests__/skillsMessageHandler.spec.ts src/core/tools/__tests__/skillTool.spec.ts`
    - `pnpm --dir src exec eslint --prune-suppressions --max-warnings=0 services/skills/SkillsManager.ts`
