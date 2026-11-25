# Aggregate: Optimization / Dead-Code Findings — 24 NOV 2026

Sources (both read-only, neither verified here):

- **[G]** `gem-neon-opt-24NOV2026.md` — Gemini Neon. Item IDs (E#, W#, B#, Z#) are G's own.
- **[M]** `muse-sparkn-opt-24NOV2026.md` — Muse Spark. Section numbers (§) are M's own.

This file only merges and attributes. Claims are as reported by each source. Nothing was re-checked.

---

## 1. Reported by both

| Topic                                        | [G]                                                                                                         | [M]                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `eslint-suppressions.json` size              | 2,847 suppressions / 262 files, all `no-explicit-any`; 323 in 77 prod files, 2,516 in 184 test files (§4.7) | 2,847 / 262 files; concentrated in provider specs: `bedrock.spec.ts` 37, `gemini.spec.ts` 33, `anthropic-vertex.spec.ts` 31 (§4) |
| `knip.json` exclusions hide dead code        | Z5: 4 test-only zombie files behind `!` exclusions; stale exclusions for live files                         | §1.2: exclusions are blind spots; shrink the list                                                                                |
| `src/utils/WorkspacePathResolver.ts`         | Dead; imported only by its own test (Z5)                                                                    | Only importer is its own spec; delete or un-exclude (§1.2)                                                                       |
| `core/tools/helpers/toolResultFormatting.ts` | Dead; imported only by its own test; has a suppression entry (Z5, §4.7)                                     | Imported only by its own spec; "verify with a full-graph check before deleting" (§1.2)                                           |
| `src/utils/TaskSemaphore.ts` exclusion       | Stale; imported by `TaskScheduler.ts:1` (Z5)                                                                | Stale but harmless; same import (§1.2)                                                                                           |
| `structuredClone` in `Task.ts` hot paths     | E7: `structuredClone` at `Task.ts:1635, 1873` is part of O(N²) save cost                                    | §3.3: cites the same lines as the preferred clone, versus `JSON.parse(JSON.stringify())` at `Task.ts:880, 6494`                  |
| `countTokens` worker pool                    | E2: static `tiktoken` import pulls 2.2 MB into main bundle; pool never terminated in `deactivate()`         | §3.6: `maxWorkers: 1`, `maxQueueSize: 10` may shed or serialize bursts; needs measurement                                        |
| Repeated full state hydration                | E6: 38 full `postStateToWebview()` calls in `webviewMessageHandler.ts`                                      | §3.1: `getState()` awaited repeatedly in `ClineProvider.ts` (lines 473, 483, 491, 711, 1129, 1163, 1295, 1587)                   |
| `webviewMessageHandler.ts` is oversized      | Counted via its 38 state-push calls (E6)                                                                    | God file: 4,434 lines, ~159 `case` branches; split by domain (§2.1)                                                              |
| Heavy webview chat components                | W4/W5/W8: `ChatRow` memo defeated; per-row iframe, queries, listener; `ChatView` re-render per keystroke    | §3.7: `ChatView` 2,000 lines, `ChatRow` 1,807; memoize rows, virtualize history                                                  |
| Test config sprawl                           | B5: 9 vitest configs; workflow tests double-run; broken coverage glob                                       | §2.4: 9 configs; risk of tests landing in the wrong shard                                                                        |
| i18n tooling / orphaned keys                 | §4.5: orphaned keys across locales; extend `find-missing-translations.js`                                   | §2.5: ensure CI runs the translation scripts                                                                                     |

---

## 2. Reported only by [G]

### Extension host

- **E1** Startup loads all 18 locales synchronously: 126 JSON files, 836 KB, ~145 syscalls.
- **E2** (extra detail) `tiktoken/encoders/o200k_base` is 2.2 MB in the main bundle; the pool is not terminated on error or in `deactivate()`.
- **E3** `migrateSettings` runs up to 7 sequential disk checks every activation; a TODO says remove it in Sept 2025.
- **E4** 36 `SecretStorage` reads at activation.
- **E5** No negative cache in OpenAI Codex and Kimi Code OAuth managers; 2 sequential `SecretStorage` calls on each state push, and a possible live token refresh.
- **E8** `CustomModesManager.getCustomModes()` writes `globalState` on every TTL expiry even if unchanged; dead `globalModes` Map.
- **E9** `normalizeString()` builds 8 `new RegExp()` per call in the fuzzy diff loop.
- **E10** `web-tree-sitter` never calls `.delete()` (WASM heap leak) and has no parser or language cache.
- **E11** Sync `existsSync` / `lstatSync` per `@` file-search keystroke; a new ripgrep process each time.
- **E12** `WorkspaceTracker` watches `**` without `ignoreChangeEvents`; resends up to 2,000 `filePaths` on tab switch.
- **E13** `RooIgnoreController.validateAccess()` calls uncached `realpathSync` in loops.
- **E14** `getModelsFromCache()` has no negative cache and does a sync disk read plus Zod validation on cold start.

### Webview

- **W1** Monolithic `ExtensionStateContext` re-renders 80 consumer sites on every streaming chunk.
- **W2** `webviewDidLaunch` is posted twice on mount (`App.tsx:190` and `ExtensionStateContext.tsx:639`).
- **W3** Full `taskHistory` re-sort and `historyCache.clear()` on each update.
- **W6** `CodeBlock` scroll and resize listeners cause forced reflows; per-block `MutationObserver`; a streaming highlight race.
- **W7** `MarkdownBlock` plugin arrays are recreated every render.
- **W9** `FileChangesPanel` resets state on every streaming chunk.
- **W10** `new Fzf(...)` on every `@` or `/` keystroke.
- **W11** `HistoryView` passes inline `forwardRef` to Virtuoso, which remounts the list each render.
- **W12** `SettingsView` mounts all 17 tabs on open to build its search index.
- **W13** Unvirtualized `MarketplaceListView`.
- **W14** Shiki loads all ~60+ themes when only 4 are used.
- **W15** `mermaid` (~2 MB+) and secondary views are in the main chunk.
- **W16** `initializeSourceMaps()` re-fetches the JS bundle and injects 5 preload tags.

### Build and packaging

- **B1** 7 unused `tree-sitter-wasms` binaries, 10.17 MB (led by `tree-sitter-objc.wasm` at 7.53 MB).
- **B2** 13 MB `esbuild-wasm` bundled in the VSIX; declared only in `devDependencies`.
- **B3** `assets/marketplace/` and `tiktoken_bg.wasm` packaged twice; production sourcemaps always shipped.
- **B4** Dependency skew: type-only `openai` in `packages/core` dependencies, React 18/19 mismatch in `apps/cli`, `catalog:` candidates, redundant root devDependencies.
- **B5** (extra detail) `vitest.config.ts:24` coverage glob matches 0 files; `turbo.json` excludes only 1 of 4 workflow tests.

### Zombie and dead code

- **Z1** `@roo-code/cloud` (2,887 LOC) never initialized; dead branches in `ClineProvider`, `Task`, `webviewMessageHandler`, `MdmService`, and unused cloud fields in `ExtensionStateContext`.
- **Z2** `@roo-code/telemetry` is a no-op with 0 clients; stale `POSTHOG_API_KEY` in `turbo.json` and `verify-build-cache-inputs.mjs`; unused `@types/vscode`.
- **Z3** Dead `textMateToHljs` theme pipeline.
- **Z4** Inverted `NODE_ENV === "test"` check in `src/utils/logging/index.ts:25`.
- **Z5** (extra detail) 4 zombie files (also `versionToken.ts`, `Bm25Ranker.ts`); nonexistent `apps/vscode-nightly` workspace in `knip.json`; stale exclusion for `services/tools/types.ts`; unused `source-map` and `@types/katex` in `webview-ui`.
- **Z6–Z14** Next.js configs; `cookie-consent.ts`; `packages/build` vitest config; `scripts/find-missing-i18n-key.js`; hardcoded Roo Cloud URLs in `apps/cli`; `injectEnv`; `getRequestyAuthUrl` and `parseStackTrace`; `key` prop in `ModelDescriptionMarkdown`; dead CSS in `index.css`.
- **§4.5** Orphaned i18n keys: 86 (src) and 196 (webview) across 17 non-`en` locales; `command.documentation.title` unreferenced.
- **§4.6** Duplicates: `escapeRegExp` ×3, `fileExists`, 4 re-export shims in `src/shared/`, split mention helpers, uncached `Intl.NumberFormat`; overlapping libraries (2 markdown engines, 4 icon libraries, `styled-components` next to Tailwind, 3 checkbox implementations).
- **§4.7** (extra detail) 2 deleted files still in suppressions (`zoo-gateway.spec.ts` 8, `zoo-code-auth.test.ts` 3); run `eslint --prune-suppressions`.

---

## 3. Reported only by [M]

- **§1.1** Knip flags 5 unused files (production run): `packages/types/src/providers/zoo-gateway.ts`, `src/services/zoo-gateway-credentials-sync.ts`, `src/api/providers/fetchers/zoo-gateway.ts`, `src/api/providers/zoo-gateway.ts`, `src/services/zoo-code-auth.ts`. The full run flags the first two, plus unused export `isZooCodeAuthenticated` (`zoo-code-auth.ts:241`).
- **§1.3** `console.log` in non-test `src` files (`persistenceTrace.ts`, `ProviderSettingsManager.ts`, `webviewMessageHandler.ts`, `ClineProvider.ts`, `extension.ts`, `git.ts`, `integrations/terminal/*`); route intentional ones through `outputChannelLogger.ts`. `TODO`/`FIXME`/`HACK` markers across `importExport.ts`, `Task.ts`, `NativeToolCallParser.ts`, `experiments.ts`, `skills.ts`, and several providers.
- **§2.1** Other god files: `Task.ts` 6,619 lines, `ClineProvider.ts` 5,415, `parse-command.ts` 3,258, `McpHub.ts` 2,594. Suggested first extractions from `Task.ts`: persistence serialization and telemetry-snapshot helpers.
- **§2.2** ~40 provider modules and 17 near-identical model fetchers; consolidate into one configurable OpenAI-compatible fetcher. Do not merge the ~20 `transform/` modules aggressively.
- **§2.3** `core/prompts/tools/native-tools/*` parallels `core/tools/*.ts`; two hierarchies to keep in sync.
- **§3.2** `TaskHistoryStore.ts:181` sorts the full cache on every read; `ClineProvider.ts:3608, 4165` sort per refresh.
- **§3.3** `JSON.parse(JSON.stringify())` at `Task.ts:880, 6494`; standardize on `structuredClone`.
- **§3.4** `clone-deep` is used once (`UpdateTodoListTool.ts:5`); replace with `structuredClone` and drop `@types/clone-deep`.
- **§3.5** `lodash.debounce` in 3 places (`ClineProvider`, `Task`, `cache-manager`); a shared `debounceAsync` would be a correctness win.
- **§4** Typed-test guidance in `AGENTS.md` already covers the `any` debt; apply it in files being split.

---

## 4. Where the reports differ

| Item                           | [G]                                                                                           | [M]                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `services/tools/Bm25Ranker.ts` | Dead: imported only by its own unit test, 0 production callers (Z5)                           | Live: reachable via `src/services/tools/index.ts:1` (`createRanker()`); the exclusion only hides future rot (§1.2) |
| Zoo gateway code               | Not flagged as unused. Mentions only the stale `zoo-gateway.spec.ts` suppression entry (§4.7) | 5 files plus 1 export are knip-unused (§1.1)                                                                       |
| Knip state                     | Treats `knip.json` exclusions as the problem                                                  | Reports both knip commands exiting 1 this session (5 files / 2 files + 1 export)                                   |
| Cloud/telemetry                | Large section on `@roo-code/cloud` and `@roo-code/telemetry` as zombies (Z1, Z2)              | Not mentioned                                                                                                      |
| Measurement                    | Cites counts, line numbers and sizes as evidence (e.g. 10.17 MB, 126 files)                   | States explicitly that no profiling or bundle measurement was run (§6)                                             |

Context from earlier in this session, not from either report: the full and production `knip` runs I did after adding the Muse/Antigravity providers both passed with no unused files. That conflicts with the knip results [M] reports, and I have not investigated it.

---

## 5. Priorities each source proposes

**[G] phased roadmap**

1. Quick wins (1–2 days): W14, W2, W11, W16, E10, E5, E1, E2, Z3, Z4, B5, prune suppressions/knip/`POSTHOG_API_KEY`.
2. Streaming and webview smoothness (3–5 days): W5, W4, W6–W10, W12, W15, E6.
3. Standalone cleanup and VSIX diet (3–5 days): B1, B3, Z1–Z2, Z5–Z14, orphaned i18n keys, B4.
4. Structural refactors (1–2 weeks): W1, E7, E4, B2, webview library consolidation.

**[M] ordered list**

1. Delete or park the 5 knip-flagged Zoo files and the dead export.
2. Audit `WorkspacePathResolver.ts` and `toolResultFormatting.ts`; delete or un-exclude.
3. Replace the two `JSON.parse(JSON.stringify())` snapshots in `Task.ts`; drop `clone-deep` if unused.
4. Cache or batch `getState()` reads and sort-on-read history (measure first).
5. Split `webviewMessageHandler.ts` by domain; extract persistence and telemetry helpers from `Task.ts`.
6. Consolidate the 17 model fetchers.
7. Triage `TODO` markers and the `console.log` sweep.

---

## 6. Caveats each source states

- **[G]** Read-only audit of the working tree on branch `refactor/standalone-independence`. No source files were modified.
- **[M]** Static review only. No runtime profiling, no webview bundle measurement, test-shard mapping not traced per file, and external consumers of the Zoo gateway code not checked.
