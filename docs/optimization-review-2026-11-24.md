# Optimization review for 24 November 2026

This review reconciles `aggregate-opt-24NOV2026.md`, `gem-neon-opt-24NOV2026.md`, and `muse-sparkn-opt-24NOV2026.md` against the integrated `main` branch. The item numbers refer to the original reports.

| Finding                          | Disposition           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini E1, E2, E5, E8–E11        | Implemented           | Activation reads the active locale and its fallback. The host and worker share tokenizer assets and load them as needed. OAuth status reads run concurrently and cache missing credentials. Custom modes skip unchanged writes. Text normalization reuses regular expressions. Tree-sitter shares initialization and parsers across concurrent requests and releases parsed trees. File search uses asynchronous filesystem checks. |
| Muse §3.1                        | Partial               | Each provider state reply now reads one settings snapshot. A profile change during custom-mode loading appears consistently in the reply. Other callers that request full state still need individual workload checks.                                                                                                                                                                                                              |
| Muse §3.6                        | Implemented           | A burst of 24 token counts now stays on the worker. The largest heartbeat gap fell from 212 ms to 3 ms in the real-worker fixture.                                                                                                                                                                                                                                                                                                  |
| Gemini E3                        | Implemented           | Startup lists the settings directory before checking legacy migration paths. A clean directory uses one scan. Failed migrations and later file restores remain eligible for migration.                                                                                                                                                                                                                                              |
| Gemini E14                       | Partial               | Model-cache misses have a five-minute TTL. Catalog requests read files asynchronously and share pending reads. Synchronous model metadata callers can still fall back to disk.                                                                                                                                                                                                                                                      |
| Gemini E4                        | Implemented           | Startup lists stored secret keys on supported hosts and reads just the managed values. The empty fixture went from 36 value reads to one key-list request. Older hosts use individual reads.                                                                                                                                                                                                                                        |
| Gemini E6                        | Implemented           | Settings and integration status changes use the existing state reply that omits the transcript and history. Six full posts serve initial load and task changes. The auto-approval fixture fell from about 856 KB to 6 KB per reply.                                                                                                                                                                                                 |
| Gemini E7                        | Partial               | Task usage totals select accounting rows before aggregation. Equal UI transcript merges skip replacement under the file lock. UI and API snapshots reuse strings, and the merge tracks consumed records in its timestamp groups. Changed snapshots still write the full file.                                                                                                                                                       |
| Gemini E12                       | Implemented           | Tab changes send only tab data unless a file change is pending. The webview keeps its file list and skips indexing requests on tab-only updates. Workspace resets clear the list, and scans from a previous workspace are discarded.                                                                                                                                                                                                |
| Gemini E13                       | Rejected              | An access decision must use the current resolved path. The cached path could retain an earlier decision after the target changed. A focused test checks both results.                                                                                                                                                                                                                                                               |
| Muse §3.2 and Gemini W3          | Implemented           | The host reuses sorted history. Item updates sort only when they move a row. Equal full snapshots keep the history array and search index. The 600-task fixture went from 12 rebuilds to zero.                                                                                                                                                                                                                                      |
| Gemini W1                        | Partial               | The app shell, translation provider, History, and reasoning blocks subscribe to the state they use. The History fixture eliminated 16 shell renders and 192 timestamp formats during a background stream. The reasoning fixture eliminated 384 completed block renders. Other readers still use the shared context.                                                                                                                 |
| Gemini W2, W11, W14, W16         | Implemented           | One startup message follows registration of the state listener. Both history lists use a stable Virtuoso component. Shiki initializes four of its 65 bundled themes. Error handlers load source maps on demand.                                                                                                                                                                                                                     |
| Gemini W4                        | Implemented           | The tail receives stream props, and only related rows read the transcript. In the 25-row fixture, completed subtask and todo displays went from 96 combined renders to zero across 16 tail updates.                                                                                                                                                                                                                                 |
| Gemini W5                        | Implemented           | Only the last chat row observes its height. Rows create no measurement iframe. Only an open editor loads the selected model and subscribes to image replies.                                                                                                                                                                                                                                                                        |
| Gemini W6                        | Implemented           | Code blocks share theme and toolbar listeners. The toolbar batches reads before writes, and superseded highlights cannot replace new code. A 30-event Chromium burst across 12 blocks fell from 360 synchronous reads to zero and needed 12 reads over two frames. Long partial code displays as plain text while it changes. The fixture went from 17 Shiki conversions to one.                                                    |
| Gemini W7                        | Implemented           | The webview combines long partial Markdown updates. It renders short partial updates and final text immediately. The rich Markdown fixture went from 17 parses to 9.                                                                                                                                                                                                                                                                |
| Gemini W8                        | Implemented           | The visibility cache initializes once per mount. Draft edits update the composer. The task header rendered zero times during 24 edits in the transcript fixture, down from 24.                                                                                                                                                                                                                                                      |
| Gemini W9                        | Implemented           | Unrelated streaming updates keep open diffs and their cached contents. The panel reuses parsed edit payloads, compares actual edits before resetting, and accepts file-read replies only for the current request. It still scans the message list.                                                                                                                                                                                  |
| Gemini W10                       | Implemented           | Mention search reuses the index for each list and excludes entries supplied by workspace search. A 64-query fixture with 2,000 paths returned the same match count. Median runtime fell from 287 ms to 5.3 ms over nine trials.                                                                                                                                                                                                     |
| Gemini W12                       | Implemented           | Settings mounts the selected tab. Search uses translated definitions and the current form values. Opening the Language tab took 5 commits in the fixture, down from 24.                                                                                                                                                                                                                                                             |
| Gemini W13                       | Implemented           | Marketplace filters run in the webview. The view receives each catalog reply once and skips catalog serialization during filtering. Card renders fell from 218 to 52 in the bundled catalog fixture.                                                                                                                                                                                                                                |
| Gemini W15                       | Implemented           | Settings, History, Marketplace, and Mermaid load on demand. The production manifest shows 3.17 MB of initial JavaScript, down from 4.19 MB. Chromium opened each view and rendered a diagram with a nonce-based script policy.                                                                                                                                                                                                      |
| Gemini B2                        | Verified in the VSIX  | Bundled esbuild loads a Brotli payload on demand. The VSIX is 721,775 bytes smaller, and the installed compiler payload is 10,848,579 bytes smaller.                                                                                                                                                                                                                                                                                |
| Gemini B1 and B3                 | Verified in the VSIX  | The package contains 29 language WASMs, one tokenizer WASM, and zero source maps. The standalone baseline contained 36 language WASMs, two tokenizer WASMs, and 531 source maps. The compressed package went from 35.16 MiB to 20.00 MiB.                                                                                                                                                                                           |
| Gemini Z1, Z2, Z10 and Muse §1.1 | Runtime work complete | The extension starts without Zoo Gateway, upstream account authentication, Roo Cloud initialization, or PostHog clients. The five Zoo files listed by Muse are gone. The retired-provider handler can still open old tasks. The Roo Cloud runtime package is gone. CLI releases use the fork repository. Upstream Marketplace and Discord jobs run only in the upstream repository.                                                 |
| Gemini Z3                        | Implemented           | The host no longer reads or sends the unused TextMate theme. Code blocks and Mermaid diagrams still use the VS Code theme.                                                                                                                                                                                                                                                                                                          |
| Gemini Z4–Z5 and Muse §1.2       | Source verified       | The compact logger's environment check differs from its comment. `Bm25Ranker` is live through `ToolRouter` and `createRanker`. `WorkspacePathResolver` and `toolResultFormatting` have only test callers. The repository documents `versionToken` as staged work.                                                                                                                                                                   |
| Gemini §4.7 and Muse §4          | Verified by count     | ESLint suppressions declined from 2,847 across 262 files to 2,743 across 259 files. Full and production Knip both pass after removal of a test-only archive helper.                                                                                                                                                                                                                                                                 |
| Gemini B5 and Muse §2.4          | Implemented           | The four workflow specs run in their own lane. The coverage verifier checks this split. Each coverage lane records the source it executes.                                                                                                                                                                                                                                                                                          |

The remaining extension state readers in Gemini W1 need workload data before further changes. The reports also identify dependency, translation, and source cleanup. Those items still need individual consumer checks. Source inspection and file counts establish the changes above. Overall startup and streaming latency were not profiled.

The packaged extension passed two isolated VS Code runs. The first monitored the extension host before activation and observed no outbound attempts. The second used a loopback Ollama mock and reopened both a new task and a task with a retired profile. The renderer proxy observed no requests in either run. The VSIX keeps the current extension identifier so existing VS Code data remains accessible. Separate distribution and side-by-side installation remain open.

## Roo Cloud package removal

The extension no longer loads Roo Cloud or builds an upload timestamp set when it opens a saved task. The main bundle fell from 15,734,776 to 15,689,180 bytes. The VSIX fell from 20,957,040 to 20,944,758 bytes. An artifact test checks that the bundle contains neither Roo Cloud service endpoint.

Provider selection and task creation still enforce the retained allowlists. The extension keeps machine-supplied and saved allowlists, profiles, and task data. The legacy `requireCloudAuth` file had no enforcement caller in the standalone extension. The extension no longer reads it. Existing files and stored credentials stay in place. Legacy webview sign-in messages return an explanation, and the package changelog remains as history.

## Packaged TypeScript compiler

Custom tools use esbuild to bundle local TypeScript imports and npm modules. Regular builds store the same WASM compiler with Brotli compression. The packaged compiler process decodes it when a tool needs compilation. Watch builds copy the original asset to avoid adding compression time to each rebuild.

The VSIX fell from 20,946,385 to 20,224,610 bytes. Its installed compiler payload fell from 13,978,850 to 3,130,271 bytes. The archive comparison found content changes in the compiler launcher, compiler payload, and the VSIX content-type manifest. Brotli compression at quality 6 took 191 ms in the build probe.

With outbound access blocked on macOS, both extracted packages compiled and ran the same tool and produced identical JavaScript. Nine measured trials after two warm-up runs put the median uncached compiler launch at 226.34 ms before compression and 249.98 ms after it. The observed ranges were 216.06–245.31 ms and 237.15–270.25 ms. The package test also compiles an enum, a local TypeScript import, and a CommonJS package, then runs the bundled result after removing the fixture package.

## Webview settings replies

Twenty-nine call sites now use the smaller reply. The initial load and transcript or history changes still send full snapshots. The webview retains both lists, and the CLI retains its transcript and pending approvals.

A fixture ran 24 auto-approval toggles per trial with 300 transcript messages and 1,500 history entries. Each trial used the extension handler and serialized every reply to JSON in the host test fixture. Median reply size fell from 856,152 to 6,047 bytes. Full-history reads fell from 24 to zero per trial. The median for each batch fell from 15.46 ms to 2.00 ms over nine trials after two warm-up runs. The observed ranges were 15.20–18.49 ms and 1.70–3.97 ms. These timings cover host work and JSON serialization. They exclude VS Code transport and renderer time.

## Provider state snapshots

The provider reads one settings snapshot after it loads custom modes. The active profile name, provider credentials, and model ID come from that snapshot. The task restore path uses its existing snapshot to read provider settings too. A focused test reproduced an old profile name paired with a new model and credentials. It now verifies that a profile change during custom-mode loading appears consistently in the reply.

The fixture called each state method 240 times per trial with the real provider and settings cache. Across nine measured trials after three warm-up runs, snapshot reads fell from 480 to 240 per batch. The median for `getState` fell from 7.69 ms to 5.20 ms, with ranges of 7.49–8.87 ms and 4.93–6.31 ms. The median for `getStateToPostToWebview` fell from 10.32 ms to 8.13 ms, with ranges of 9.97–10.53 ms and 7.40–8.74 ms. The fixture measures host work with simulated VS Code storage and custom-mode loading.

## Settings search

Settings opens the selected tab and builds the fuzzy index on the first nonempty query. The index uses the display language and includes controls available under the current unsaved settings. Focused tests compare the index with the rendered controls in all 17 tabs under three settings configurations.

The production webview passed a Chromium check with a simulated extension host. The check used the keyboard to find a control on an unvisited tab, changed the control, moved to another search result, and confirmed that Save sent the edit. A focused test also covers a pending blur timer when focus returns to the search box.

The JSDOM fixture opened a new Language tab seven times after two warm-up runs. The median time to render fell from 39.47 ms to 10.61 ms. The observed ranges were 37.64–43.58 ms and 9.20–16.68 ms. React commits fell from 24 to 5, and messages to the simulated host fell from 10 to 1. These numbers measure rendering in the test fixture. VS Code startup and transport latency are outside the timing.

## Marketplace filtering

The webview filters the loaded catalog by type, search text, tags, and installation status. The host still loads the catalog and installation status on request. Focused tests check the returned items for each filter, confirm that clearing the filters restores the full catalog, and confirm that a catalog refresh reapplies the current filter.

A Chromium check of the production webview loaded the bundled catalog through a simulated host. It searched both Marketplace tabs, cleared the filters, and confirmed that those actions sent zero Marketplace messages to the host. A reply with only installation metadata updated both the card and the Installed filter.

A fixture ran 12 search edits against the 43 bundled items. It passed webview requests to the extension handler and recorded the handler's calls to send state. Across seven trials after two warm-up runs, requests, catalog loads, and state replies each fell from 12 to zero. The count of visible items matched after each edit. Median time per batch fell from 57.83 ms to 0.10 ms, with ranges of 54.93–59.28 ms and 0.10–0.12 ms. The timings include catalog loading and filtering. They exclude state assembly, VS Code transport, and rendering.

A separate JSDOM fixture ran the same 12 edits in the MCP tab. One catalog reply now reaches the state manager once, down from twice. Per batch, catalog serializations fell from 96 to zero and card renders fell from 218 to 52. Each edit returned the same number of cards as before. The median time per batch fell from 141.56 ms to 60.56 ms over seven trials after two warm-up runs. The observed ranges were 136.95–158.10 ms and 55.92–65.78 ms. The catalog has 31 MCP cards and 12 mode cards.

## Task usage accounting

Task metadata and current usage now select accounting rows before calculating totals. Legacy request finishes still participate in request pairing. If a command or MCP row shares an accounting timestamp, the code uses the original consolidation path to preserve the recorded result.

A metadata fixture calculated 24 snapshots of a 1,281-row transcript. The median for a batch fell from 38.12 ms to 0.92 ms over seven trials after two warm-up runs. The observed ranges were 37.17–41.69 ms and 0.82–1.15 ms. Token totals, cache reads, context tokens, cost, and the final timestamp matched. The fixture simulated file-system calls to measure the metadata calculation. Focused tests check legacy pairing, shared timestamps, and skipping access to command and MCP output.

The packaged extension ran a task through a loopback Ollama fixture and reopened it from history. Its saved record reported the expected 100 input and 20 output tokens.

## Repeated UI transcript saves

The UI transcript writer compares the merged snapshot with the committed file after recovery, while holding the advisory lock. An equal result satisfies the save. Focused tests cover peer updates, clearing an optional field, recovery before the comparison, an initial empty file, and corrupt JSON.

The disk fixture saves eight snapshots of a 1,281-row, 8.1 MB transcript per batch. Across seven trials after two warm-up runs, unchanged batches went from eight replacements to zero. Their median fell from 198.38 ms to 86.30 ms, with observed ranges of 190.44–211.97 ms and 83.30–92.31 ms. Batches with tail edits still completed eight replacements and returned the expected transcript. Their median rose from 200.08 ms to 209.74 ms, with ranges of 190.49–211.61 ms and 199.16–218.78 ms. The fixture uses the real writer and includes snapshot cloning and lock acquisition.

## Transcript merge allocations

The UI and API merges mark each used record in its timestamp group. A focused test checks that legacy upgrades consume each match once and keep unrelated records at the same timestamp. A comparison with the previous implementation returned equal results for 10,000 generated snapshot pairs through both merge entry points.

For 96 merges of a 1,281-row snapshot per batch, the UI median fell from 20.50 ms to 12.56 ms and the API median fell from 13.36 ms to 5.29 ms. Across nine measured trials after three warm-up runs, the ranges were 20.28–20.99 ms and 12.39–12.80 ms for UI, and 13.06–13.88 ms and 5.10–5.54 ms for API. The corresponding fixture with a peer record at the same timestamp showed similar results.

Across seven measured trials after three warm-up runs, eight tail edits to a 9.37 MB transcript took a median of 326.74 ms before the change and 322.17 ms after it. The observed ranges overlapped at 320.81–343.77 ms and 318.74–330.33 ms. Each run used the real file writer and produced identical JSON. A separate probe found that 16–64 KiB serializer buffers issued fewer stream writes and took longer to save the large transcript.

## Transcript snapshot copies

The UI and API save paths take a detached copy before starting asynchronous file work. The copy reuses immutable strings and duplicates mutable objects and arrays. Accessors and other non-plain values use the native clone. Focused tests mutate live tool input, images, and progress while a save is pending and verify that the writer has the earlier data.

A fixture ran 16 copies per batch through the task save entry points and simulated the disk writer. Over seven trials after two warm-up runs, the median for the 1,281-row, 8.7 MB UI transcript fell from 32.51 ms to 15.39 ms. The observed ranges were 30.91–53.06 ms and 15.25–15.66 ms. The matching API fixture fell from 38.47 ms to 20.91 ms, with ranges of 34.89–40.38 ms and 20.53–21.68 ms. A short transcript with one image took 0.23 ms for UI history and 0.28 ms for API history, down from 1.00 ms and 1.04 ms. The short text-only fixture added about 8 microseconds per copy in both paths.

## Shared tokenizer assets

The extension host and worker load the same installed encoding table and WASM binary. The first concurrent counts share the initialization in each runtime. The tokenizer retries after a failed asset load. The extension shuts down the worker pool on deactivation. Source tests also exercise resolution through the installed npm dependency during development.

The release archive fell from 20,224,610 to 19,086,046 bytes. The main JavaScript bundle fell from 15,691,727 to 13,366,390 bytes, and the worker fell from 2,360,798 to 35,481 bytes. The package adds one 2,325,457-byte encoding table. An artifact test checks that neither bundle embeds the ranks and that a copy of the worker runs with only the two shared assets.

Across nine fresh processes after three warm-up runs, median time to parse the main bundle fell from 103.73 ms to 99.30 ms, with ranges of 102.29–106.45 ms and 97.77–101.51 ms. The first worker count fell from 101.50 ms to 90.19 ms, with ranges of 98.52–102.49 ms and 89.57–92.49 ms. The first direct fallback count fell from 84.10 ms to 77.11 ms, with ranges of 82.41–85.55 ms and 76.94–80.37 ms. Both versions returned 48 tokens for the same mixed input. The parse fixture measures JavaScript parsing outside VS Code.

With outbound access blocked, a separate probe ran the packaged worker and bundled fallback. It restored a deliberately missing encoding table and verified that ten parallel fallback counts read each shared asset once.

## Token counting bursts

The ten-entry queue limit used to reject work during a burst. The rejection stopped the pool and moved both pending and later counts onto the extension host. The single worker now drains requests in submission order. The fallback still handles worker failures.

The real-worker fixture submitted 24 requests with 80,000 bytes of text and a small tool result each. Across seven trials after two warm-up runs, the median of the largest gap between host heartbeat samples fell from 211.96 ms to 3.07 ms. The ranges were 211.25–219.04 ms and 2.74–3.57 ms. All 24 burst requests and the follow-up used the host before the change and the worker after it. Results matched the local tokenizer. Median batch completion took 211.81 ms before the change and 215.16 ms after it.

A separate two-worker probe cut median completion time to 146.23 ms and raised peak process RSS by about 51 MiB compared with the one-worker probe. The implementation keeps one worker to retain the lower memory cost. The fixture uses Node and the packaged worker. It measures the event loop during the burst.

## Credential reads

Startup and settings refresh first list the secret keys when the host supports that operation. The extension reads managed keys from the list and checks previously cached keys so it can detect deletions. Tests cover a provider key, a global key, a failed enumeration, and a write that finishes while enumeration is pending. VS Code added the API in 1.105. [VS Code release notes](https://code.visualstudio.com/updates/v1_105#_list-keys-in-secretstorage)

The simulated storage queued one request at a time. Across seven runs after two warm-up runs, an empty store went from 36 value reads to one key-list request. Median time fell from 41.54 ms to 1.20 ms, with ranges of 40.67–44.16 ms and 1.19–1.29 ms. The fixture with two managed secrets went from 36 reads to one list and two reads. Its median fell from 43.39 ms to 3.90 ms, with ranges of 41.26–86.60 ms and 3.54–10.13 ms. The host without the listing API made 36 reads in both versions.

A fresh-profile startup trace on VS Code 1.147 recorded 48 extension secret-value reads before the change and 12 after, plus one key-list request after the change. The trace covers activation, opening the sidebar, and opening Settings. A fresh context in the same test host reloaded both fixture credentials from SecretStorage.

## Chat rows during streaming

Chat rows read shared state at their outer boundary. The row body receives the complete transcript only when it needs other messages for subtask links or earlier todo values. The view sends checkpoint navigation and follow-up controls to the rows that use them. Tests check that the tail displays new text and that completion metadata refreshes the relevant subtask link.

The JSDOM fixture rendered 24 completed text rows and one streaming row. Over seven runs after two warm-up runs, 16 tail updates went from 400 row-body renders to 16. The median time per batch fell from 63.06 ms to 4.17 ms, with observed ranges of 57.57–67.65 ms and 3.91–6.82 ms. The fixture measures renderer work for visible rows and checks the final text and row count.

Chromium ran the production webview against a simulated host. It displayed the final streamed text and kept both earlier rows visible.

The general row subscribes to display settings and checkpoint data. Subtask and todo rows read the transcript to resolve a child link, detect an adjacent result, or identify an earlier todo update. Their rendered bodies receive only those values.

A second JSDOM fixture used 25 rows with two completed subtasks, four todo updates, and a streaming tail. For 16 tail updates, subtask result body renders went from 32 to zero and todo display renders went from 64 to zero. Reads of the full extension state, including reads by the fixture list, went from 416 to 144. Across seven runs after two warm-up runs, median batch time fell from 9.08 ms to 3.97 ms. The observed ranges were 8.49–10.71 ms and 3.68–4.89 ms. Tests check that completion metadata still supplies the correct child link and that a change to earlier todo data updates the next todo display.

In Chromium, the production webview displayed the latest tail text, updated the todo display after a change to the earlier row, and sent the correct task ID when the subtask link was clicked.

Completed reasoning blocks subscribe to the collapse preference. The active block still follows streamed text, and changing the saved preference still updates each block. Each block also keeps its own expand and collapse control.

A JSDOM fixture rendered 24 expanded, completed reasoning blocks and one streaming text row. Across nine runs after three warm-up runs, each batch of 16 tail updates caused 384 completed block renders before the change and zero after it. Median time per batch fell from 74.82 ms to 3.47 ms. Baseline timing varied from 25.48 ms to 214.90 ms. The updated runs ranged from 3.32 ms to 6.18 ms. These measurements cover the fixture. The focused regression tests check that streamed reasoning still appears immediately and that local toggles and saved preference changes still work.

## Streaming Markdown

Partial chat and expanded reasoning messages update immediately until they reach 8,192 characters. At that point, the webview combines partial updates within 240 ms of the last displayed version. Completion renders the full text immediately and cancels pending preview work. The shared Markdown renderer reuses its plugin configuration.

The JSDOM fixture sent 16 partial updates at the host's 120 ms interval, followed by completion. With about 11,000 characters of rich Markdown, the number of parses went from 17 to 9. Across seven runs after two warm-up runs, the median render time per batch fell from 268.72 ms to 144.44 ms, with observed ranges of 260.17–282.95 ms and 141.18–164.28 ms. The short-message fixture parsed all 17 updates in both versions. Its median went from 2.27 ms to 2.32 ms.

Chromium ran the production webview against a simulated host. It showed the latest partial response, rendered the completed response, and let the user scroll back to the earlier rows. Focused tests also check the completed reasoning text and clipboard content.

## Chat composer updates

The composer subscribes to its draft text. The chat view subscribes to whether a follow-up has a nonblank draft. It reads the current draft when the user submits it, adds context, or selects a suggested response. The draft keeps mention segments with the text so a submission uses the correct source for each part.

The JSDOM fixture sent 24 input changes with 25 transcript rows. The task header rendered 24 times before the change and zero times after it. Across seven runs after two warm-up runs, the median time per batch fell from 6.11 ms to 1.67 ms, with observed ranges of 5.55–7.26 ms and 1.34–4.77 ms. The fixture uses test doubles for the header, transcript virtualization, and text area. It checks that the final draft and row count match.

The focused tests check draft submission, the follow-up pause transition, and the order of batched context additions with images. Chromium used the production composer to type and submit a response, verified its text and mention segments in the host message, and checked that the composer cleared.

## Task history snapshots

The webview reuses the previous history array when a full snapshot contains the same records in the same sorted order. The History view can then reuse its search index. Changed snapshots replace the history and rebuild its string cache. An explicit empty snapshot clears the cache. The comparison includes nested fields and sees item updates that arrived earlier in the same React batch.

The JSDOM fixture ran an active search across 600 tasks and received 12 full snapshots, alternating the full-state and history-only messages. For identical snapshots, search results and the history string cache went from 12 rebuilds to zero. Across 13 runs after three warm-up runs, the median time per batch fell from 22.53 ms to 2.29 ms. The observed ranges were 21.84–29.28 ms and 2.19–2.51 ms. When each snapshot changed the newest title, the median went from 21.41 ms to 21.27 ms.

Chromium opened the production History view against a simulated host. It kept the active search across identical snapshots, showed the renamed result after an update, and removed the result after an empty snapshot.

## Syntax highlighting while streaming

A partial Markdown code block of at least 4,096 characters displays the current code as plain text while it changes. Shiki loads the language during the stream and applies syntax colors after 320 ms without an update. The completed response skips the delay. Short blocks still receive syntax highlighting with each update.

The JSDOM fixture used the real Markdown and Shiki pipeline with 16 partial updates at the host's 120 ms interval, followed by completion. A TypeScript block starting at 5,301 characters went from 17 Shiki conversions to one. Across seven runs after two warm-up runs, median time in `codeToHast` fell from 230.17 ms to 15.96 ms, with observed ranges of 226.48–234.41 ms and 15.63–16.79 ms. Median time for the full batch fell from 358.27 ms to 52.41 ms. The short fixture still made 17 conversions, with a batch median of 18.45 ms before the change and 19.06 ms after it.

The focused test checks the 320 ms delay and verifies that a completed update cancels a pending highlight. Chromium opened the production webview and verified the plain preview, syntax colors after a pause, and the final highlighted code.

## History during background streaming

The app shell and translation provider subscribe to navigation and language state. History search and timestamps subscribe to the task list, workspace, and date and time preferences. These values keep their references when a host message only updates the transcript. A focused test checks that transcript updates still reach chat and that history and preference updates reach their subscribers.

The JSDOM fixture opened History during a chat stream with 200 tasks in storage and 12 rendered rows. It used the real History view and replaced the chat body and list virtualization with test doubles. Across seven runs after two warm-up runs, 16 partial messages produced zero shell renders and zero History timestamp formats. The baseline produced 16 shell renders and 192 timestamp formats. Median time per batch fell from 70.53 ms to 1.05 ms, with observed ranges of 67.28–71.79 ms and 0.93–1.16 ms.

Chromium opened History in the production webview, kept it visible while chat received 16 updates, and showed a renamed task. On returning to Chat it showed the last background update.

## Provider model catalog reads

Catalog requests share one asynchronous read per cache key when they miss the memory cache. Fresh provider results take precedence over an earlier disk read. An empty or failed refresh can still return a valid cached catalog. Synchronous `getModel()` calls keep their disk fallback. JSON parsing and schema validation still run on the extension host after the asynchronous read.

The fixture loaded a 992,491-byte file with 1,800 models into a cold memory cache. Across 13 runs after three warm-up runs, the median delay before a queued `setImmediate` callback fell from 3.13 ms to 0.04 ms. The observed ranges were 2.83–4.34 ms and 0.012–0.574 ms. Median time to return the full catalog went from 3.02 ms to 3.13 ms. Both versions returned the saved model metadata without calling a provider.

Focused tests cover shared reads, a cancelled caller, stale reads after refresh and flush, negative-cache invalidation, invalid catalog data, and the synchronous fallback.

Cold catalog reads use the configured storage path first and can reopen a file in default storage when the configured cache file is missing or inaccessible. A disk miss for one path does not suppress a read from a newly configured path. OpenRouter endpoint reads use the same model-specific filename as writes.

Real-file tests wrote a catalog to custom storage and reopened it through both catalog entry points while a simulated provider was offline. They also checked default storage fallback, a change of storage path after a miss, and reopening the saved endpoint list after its memory entry expired. The three reopen checks failed with the previous code. With default storage, the 1,800-model fixture recorded a median callback delay of 0.027 ms and a median catalog lookup of 3.09 ms.

## Settings migration at startup

Startup lists the selected settings directory and checks only the legacy filenames it could contain. When the listing includes converted YAML and legacy JSON, startup checks the YAML path and keeps both files. If listing fails, migration still tries the known paths. Each launch can recover files restored later or found after the user changes the storage directory. The separate default-command migration retains its completion flag.

In the real-file fixture, a clean migration went from four path checks to one directory scan. The migrated fixture with rollback JSON went from five path checks to one scan and one YAML path check. Both versions ensured that the settings directory existed. Across ten runs after three warm-up runs, the median time for 80 clean migrations fell from 4.99 ms to 3.17 ms. For the migrated fixture, the median fell from 5.55 ms to 3.86 ms. These timings cover the settings migration function.

## Task history scan and sidebar startup

The startup finding in `gem-hydro-parentrepo-survey-24NOV2026.md` (O4) is implemented. The extension sends the first sidebar state while the history scan or migration is pending. It sends a fresh state with the complete history after initialization. An older launch cannot send its delayed state to a replacement view. [Upstream proposal](https://github.com/Zoo-Code-Org/Zoo-Code/pull/2114)

`TaskHistoryStore.reconcile()` uses the directory it listed for all file checks, reads, and recovery in that scan. It resolves the storage setting again at the start of the next scan.

The fixture alternated the original and updated store against 1,000 real history files. It checked the complete newest-first result after the initial scan and again after a scan with no changed files. Across nine timed runs after four warm-up runs, the results were:

| Storage and scan                  |     Before median (range) |   After median (range) |
| --------------------------------- | ------------------------: | ---------------------: |
| Custom storage, initial scan      | 130.49 ms (129.57–131.33) | 55.55 ms (49.90–56.28) |
| Custom storage, no changed files  |    47.64 ms (46.96–50.26) |  10.76 ms (9.86–10.93) |
| Default storage, initial scan     |    56.04 ms (55.58–57.64) | 55.28 ms (54.91–56.76) |
| Default storage, no changed files |      9.79 ms (9.36–10.72) | 10.58 ms (10.04–10.79) |

Storage setting reads fell from 2,001 per initial scan and 1,001 per unchanged scan to one in both cases. The median for an unchanged scan in default storage rose by 0.79 ms, within the 1 ms comparison limit. The timings measure the store scan, with a simulated VS Code configuration and real filesystem checks. The regression test also changes the configured root between scans. The file replacement and restart model still checks the same lock and recovery rules.

The launch fixture held history initialization for 70 ms and supplied 1,000 saved tasks. The median time to the first state message fell from 74.59 ms to 0.40 ms over seven runs after two warm-up runs. The observed ranges were 72.97–75.80 ms and 0.26–0.49 ms. The median for the complete history was 74.59 ms before and 73.58 ms after, within the 2 ms comparison limit. These timings measure the host and message serialization with a controlled scan delay. Focused tests cover saves during initialization, legacy migration, failed scans, and relaunched and replaced views.

## Folder mentions

The O3 finding in `gem-hydro-parentrepo-survey-24NOV2026.md` is implemented in `src/core/mentions/index.ts`. Each folder mention lists its entries and extracts text from up to 20 files. It includes up to 64 KiB of formatted file contents. The byte limit covers long lines and multibyte text. Files whose contents do not fit remain listed, and the prompt tells the model how to open them with `read_file`. Explicit file mentions retain their own limits. [Upstream proposal](https://github.com/Zoo-Code-Org/Zoo-Code/pull/2680)

The 48-file fixture used 150 lines per file. The expanded folder block fell from 624,794 to 65,960 bytes, including the directory listing and note. The extension's tokenizer estimate fell from 301,419 to 31,901 tokens. The median expansion time fell from 9.73 ms to 4.39 ms over nine paired runs after two warm-up runs. The observed ranges were 8.35–14.97 ms and 3.42–8.64 ms. The three-file fixture produced byte-for-byte identical text, with a median time of 0.44 ms before and 0.46 ms after, within the 0.1 ms comparison limit.

The focused tests verify the file read limit, the combined UTF-8 size, the listing, and a direct mention of an omitted file. They also verify that the folder still applies ignore rules and omits binary contents. The limits apply per folder mention. Directory listings and explicit file mentions can still add tokens.

## Webview icon and date dependencies

The O1 finding in `gem-hydro-parentrepo-survey-24NOV2026.md` is implemented. The announcement uses the same three Simple Icons paths with inline SVGs. The MCP error log formats its English timestamps with native dates. The webview manifest and workspace lockfile no longer include `react-icons` or `date-fns`.

The production build manifest reported 3,171,482 bytes of startup JavaScript before the change and 3,168,933 bytes after. The gzip size fell from 870,292 to 869,372 bytes. The Settings chunk fell from 291,998 to 272,849 bytes, or from 82,217 to 76,696 bytes with gzip. The formatter stays in the Settings chunk. The source maps identify both packages in the original build and show their removal from the updated build.

All three rendered SVGs matched their previous markup. The old and new timestamp formatters produced the same labels in 64,080 cases across five time zones. Over nine paired runs after three warm-up runs, median formatting time for 4,096 labels fell from 6.26 ms to 0.84 ms. The observed ranges were 5.92–7.98 ms and 0.83–0.86 ms. The focused tests cover calendar boundaries, midnight, noon, and numeric dates.
