# Optimization / Dead-Code Opportunities — 24 NOV 2026

Scope: read-only static review of `Pet-Zoo-Code` (Roo-Code lineage). No code was changed.
Method: file-size survey, `knip` runs observed this session, targeted `grep` checks, and
spot reads of hot files. All findings below cite paths you can open. Severity is
effort-vs-risk judgment, not a test result.

Verified tool output used as oracle:

- `pnpm knip --production` → 5 unused files (exit 1, `--treat-config-hints-as-errors`).
- `pnpm knip` (full) → 2 unused files + 1 unused export (exit 1).

## 1. Zombie / dead code (remove or confirm intent first)

### 1.1 Knip-confirmed unused files

Production run flags these five; the full run still flags the first two:

- `packages/types/src/providers/zoo-gateway.ts`
- `src/services/zoo-gateway-credentials-sync.ts`
- `src/api/providers/fetchers/zoo-gateway.ts`
- `src/api/providers/zoo-gateway.ts`
- `src/services/zoo-code-auth.ts`

Full-run unused export:

- `isZooCodeAuthenticated` in `src/services/zoo-code-auth.ts:241` — sole definition site;
  no importer found by `grep -rn "isZooCodeAuthenticated" src packages`.

Action: if the Zoo gateway path is retired, delete the five files plus the type entry and
re-run both knip commands. If it is dormant (feature-flagged future), move it behind an
explicit `docs/` note so knip stops being red and reviewers stop tripping over it.

### 1.2 Knip exclusions that may hide more dead code

`knip.json` excludes these from the `src` project (lines ~22–31), so knip will never flag them:

- `utils/TaskSemaphore.ts` — actually imported by `src/core/task/TaskScheduler.ts:1`, so the
  exclusion is stale but harmless.
- `utils/WorkspacePathResolver.ts` — only importer found is its own spec
  (`src/utils/__tests__/WorkspacePathResolver.spec.ts:5`). Candidate for deletion or for
  removing the exclusion so knip watches it.
- `services/tools/Bm25Ranker.ts`, `services/tools/types.ts`,
  `core/tools/helpers/toolResultFormatting.ts` — `Bm25Ranker` is reachable via
  `src/services/tools/index.ts:1` (`createRanker()`), so it is live; the exclusion still
  hides future rot. `toolResultFormatting` is imported only by its own spec in the search
  performed — verify with a full-graph check before deleting.

Recommendation: shrink the exclusion list to files that truly need it and let knip guard
the rest. Each stale `!`-entry is a blind spot.

### 1.3 Leftover debug / marker comments

- `console.log` in non-test `src` files (e.g. `src/core/task-persistence/persistenceTrace.ts`,
  `src/core/config/ProviderSettingsManager.ts`, `src/core/webview/webviewMessageHandler.ts`,
  `src/core/webview/ClineProvider.ts`, `src/extension.ts`, `src/utils/git.ts`,
  `src/integrations/terminal/*`). Some are intentional diagnostics; the set has never been
  audited as a whole. Recommend a pass that converts intentional ones to the output-channel
  logger (`src/utils/outputChannelLogger.ts`) and deletes the rest.
- `TODO` / `FIXME` / `HACK` markers exist in `src/core/config/importExport.ts`,
  `src/core/webview/*`, `src/core/task/Task.ts`, `src/core/assistant-message/NativeToolCallParser.ts`,
  `src/shared/experiments.ts`, `src/shared/skills.ts`, `src/api/providers/openai.ts`,
  `src/api/providers/openrouter.ts`, `src/api/providers/mistral.ts`, among others.
  Recommend triaging into issues or deleting; a marker with no owner is zombie documentation.

## 2. Redundant / duplicated code

### 2.1 God files (split candidates, highest review cost)

| File                                        | Lines | Note                                                                            |
| ------------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| `src/core/task/Task.ts`                     | 6,619 | Task lifecycle, persistence, telemetry snapshots, prompt assembly               |
| `src/core/webview/ClineProvider.ts`         | 5,415 | State hydration (`getState`, `getStateToPostToWebview`), task registry, sorting |
| `src/core/webview/webviewMessageHandler.ts` | 4,434 | ~159 `case "<message>"` branches                                                |
| `src/shared/parse-command.ts`               | 3,258 | Shell scanner + placeholder expansion + heredoc handling                        |
| `src/services/mcp/McpHub.ts`                | 2,594 | MCP hub                                                                         |

`webviewMessageHandler.ts` is a message-type switch with ~159 cases; each new webview message
extends the same function. Splitting by domain (settings / task / MCP / checkpoints) behind a
`Map<string, handler>` would cut merge conflicts and make per-domain tests possible.
`Task.ts` mixes run-state, persistence (`structuredClone` at lines ~1635, ~1873), and
telemetry baselines — the persistence serialization and telemetry-snapshot helpers are the
cleanest first extractions.

### 2.2 Provider / fetcher / transform fan-out

- `src/api/providers/` holds ~40 provider modules (`anthropic.ts`, `bedrock.ts`, `gemini.ts`,
  `openai.ts`, `openrouter.ts`, …) plus `fetchers/` with 17 near-identical model-list
  fetchers (`deepseek.ts`, `friendli.ts`, `kenari.ts`, `kimi-code.ts`, `litellm.ts`, …).
- `src/api/transform/` holds ~20 per-vendor format modules (`openai-format.ts`,
  `anthropic-filter.ts`, `gemini-format.ts`, `mistral-format.ts`, `r1-format.ts`, …).

Pattern duplication across vendors (endpoint + cache + error wrap) is expected, but the
fetcher layer is the clearest consolidation target: one generic OpenAI-compatible fetcher
with per-vendor config instead of 17 files. Do not unify the transform layer aggressively —
vendor quirks live there and a wrong merge breaks correctness.

### 2.3 Prompt definitions mirror tool implementations

`src/core/prompts/tools/native-tools/` contains one file per tool (`edit_file.ts`,
`write_to_file.ts`, `search_files.ts`, `new_task.ts`, …) paralleling
`src/core/tools/*.ts` (`EditFileTool.ts`, `WriteToFileTool.ts`, `SearchFilesTool.ts`,
`NewTaskTool.ts`, …). Two parallel hierarchies must be kept in sync on every tool change.
Consider generating one from the other or co-locating prompt text with the tool class.

### 2.4 Test-heavy large files and split test configs

Largest files in the repo are specs (`Task.spec.ts` 9,104 lines, `ClineProvider.spec.ts`
8,716 lines, `vscode-lm.spec.ts` 6,722 lines). Nine vitest configs
(`vitest.api/core/dist/misc/services/tree-sitter/unit/workflow.config.ts`) partition the
suite; that is reasonable for CI sharding but raises the chance of a new test landing in the
wrong shard and silently not running in the intended gate. Keep the shard map documented
where contributors add tests.

### 2.5 Locale duplication

`webview-ui/src/i18n/locales/*/` repeats `settings.json` (~1,200 lines) across ~15 locales
(ru, pl, pt-BR, it, fr, …). This is normal for i18n but `find-missing-translations` scripts
exist (`scripts/find-missing-translations.*`, `scripts/validate-plural-forms.*`) — ensure CI
runs them so a key added to one locale and missed in others is caught mechanically rather
than by inspection.

## 3. Performance opportunities (ordered by expected return)

1. **Repeated full-state hydration in `ClineProvider`.** `getState()` is awaited in many
   adjacent call sites (`ClineProvider.ts:473, 483, 491, 711, 1129, 1163, 1295, 1587`).
   Each call rebuilds the state object sent to the webview. Batch or memoize within a tick
   where callers only read disjoint fields. Verify with a counter probe before optimizing.
2. **Sort-on-read in history paths.** `TaskHistoryStore.ts:181` sorts the full cache on every
   read; `ClineProvider.ts:3608, 4165` sort workspace tasks per refresh. Maintain a
   sorted index or sort once per mutation, not per read. Low risk, visible on large histories.
3. **`JSON.parse(JSON.stringify(...))` in hot paths.** `Task.ts:880` (token-usage snapshot
   inside a debounced emitter) and `Task.ts:6494` (telemetry baseline) use
   `JSON.parse(JSON.stringify(...))` while neighboring code uses `structuredClone`
   (`Task.ts:1635, 1873`, `TaskHistoryStore.ts:1018`, `ProviderSettingsManager.ts:686`).
   Standardize on `structuredClone` (or a shallow copy where depth is known) — faster and
   preserves types the JSON round-trip drops.
4. **Single-use `clone-deep` dependency.** Only `src/core/tools/UpdateTodoListTool.ts:5`
   imports `clone-deep`. Replacing that one call with `structuredClone` removes a dependency
   and its `@types/clone-deep` entry. Trivial, but confirm Node target supports
   `structuredClone` for the value shape first.
5. **`lodash.debounce` in three places** (`ClineProvider.ts:10`, `Task.ts:13`,
   `code-index/cache-manager.ts:4`). Fine as-is, but these are three independent debounce
   tunings with no shared helper — a single documented `debounceAsync` with cancellation
   semantics would prevent a future double-fire bug. Not a throughput win; a correctness win.
6. **Token counting worker pool** (`src/utils/countTokens.ts:13-46`, pool config
   `maxWorkers: 1, maxQueueSize: 10`, fallback to inline `tiktoken`). Single worker plus a
   depth-10 queue means bursts of parallel count requests shed or serialize. Measure queue
   drops under a large task before widening; the fallback path already guarantees
   correctness, so this is a sizing question, not a bug.
7. **Webview bundle weight.** `webview-ui/src/components` is 7.4 MB of source; heaviest views
   are `ChatView.tsx` (2,000 lines), `ChatRow.tsx` (1,807), `ModesView.tsx` (1,789),
   `CodeIndexPopover.tsx` (1,780), `ChatTextArea.tsx` (1,427). `ChatView`/`ChatRow` render on
   every message — memoize row components and virtualize long histories before touching the
   build. No bundle measurement was taken in this pass; run the existing bundle analyzer
   before claiming a win.

## 4. Type-safety debt that slows future optimization

- `src/eslint-suppressions.json` tracks **2,847 `no-explicit-any` suppressions across 262
  files**, concentrated in provider specs (e.g. `bedrock.spec.ts` 37, `gemini.spec.ts` 33,
  `anthropic-vertex.spec.ts` 31). Suppressions are per-file counts that must never increase,
  so new typed code is protected — but the existing 2,847 `any`s blunt refactoring tools
  (rename/split god files) exactly where the risk is highest. Pay down in files being split.
- `AGENTS.md` typed-test guidance already points the right way (structural doubles,
  `unknown` + guards, single construction-site cast). No new action needed; just apply it
  when touching the god files above.

## 5. Suggested order of work

1. Delete or explicitly park the five knip-flagged Zoo files + the dead export (smallest,
   mechanically verifiable: both knip commands green).
2. Audit `WorkspacePathResolver.ts` and `toolResultFormatting.ts` reachability; delete or
   un-exclude.
3. Replace the two `JSON.parse(JSON.stringify(...))` snapshots in `Task.ts` with
   `structuredClone`; drop `clone-deep` if that was its last need.
4. Cache or batch `getState()` reads and sort-on-read histories (measure first with a
   counter/timing probe on a large history).
5. Split `webviewMessageHandler.ts` by message domain; extract persistence/telemetry
   helpers from `Task.ts`. Each split must carry its spec slice with it.
6. Consolidate the 17 model fetchers behind one configurable fetcher.
7. Triage `TODO`/`console.log` sweep; route intentional diagnostics through the output
   channel logger.

## 6. What this report did not verify

- No runtime profiling was run; section 3 items 1, 2, 6 need timing probes before sizing.
- No bundle-size measurement for `webview-ui`; section 3 item 7 needs the analyzer.
- Test-shard mapping correctness (which spec runs under which `vitest.*.config.ts`) was not
  traced per file.
- Whether the Zoo gateway code has a live external consumer outside this repo was not
  checked — confirm with the owning team before deleting.
