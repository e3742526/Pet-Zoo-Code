# ADR 0006 Native agent sessions

## Status

Implemented for local qualification. The delivery is based on the clean `main` checkout at `5b9447203` and the supplied native-engine implementation plan.

## Context

`ApiHandler` runs model requests. Dory's `Task` schedules the requests, handles approvals, and executes tools. Codex and Claude Code already own those operations. Use the same task navigation, history store, and scheduler for native sessions, with a separate projection for native output. Keep the model-backed task code out of the native execution path.

## Decision

- Use the installed Codex `0.159.0` app-server over stdio and Claude Agent SDK `0.3.284` with the installed Claude Code `2.1.284` executable. Use the user-owned authentication route, with explicit billing route selection and no fallback. Keep both executables outside the VSIX.
- Bind native records to the profile ID, engine, route, effective model, hashed account scope, runtime version, host, and canonical workspace. Record the native session ID separately. Absent engine fields use Dory. An unknown engine opens in a read-only view.
- Validate a new draft with the current profile and host policy. Validate each native turn against the persisted connection and workspace. A bounded probe checks setup without running a prompt. Profile preferences pass through the provider schema and import/export.
- Let the native runtime execute tools. Render observations as text. Keep approval requests separate from observations and scope them to one operation. Use workspace-write for Codex and Claude's default permission mode. Keep Dory-specific modes, automatic approvals, tool lists, and checkpoints out of native controls.
- Allow one input in flight. Keep unsent input in the composer. Hold a scheduler permit and checkout writer reservation through native shutdown. Store the native session reference before it can perform actions when the runtime permits it.
- Use actual checkout state for handoffs and diff review. A continuation gets a new task and two-way lineage. The user reviews the handoff before sending. Keep a recovery point separate from the native conversation.

## Delivery and evidence

| Wave | Scope                                                              | Acceptance and validation                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Shared schemas, protocol transport, scheduler and history boundary | Legacy records load, unknown engines cannot run through Dory, and bounded JSONL handles fragmentation and failure. Focused Vitest and type check.                                               |
| 2    | Codex app-server and runtime qualification                         | Start, stream, approve or deny, stop, and explicitly resume with preserved connection. Compare the protocol subset with `codex app-server generate-ts` and test with a controllable subprocess. |
| 3    | Claude SDK                                                         | Require the local executable and verified authentication. Check effective model, typed input, permissions, and resume. Use constructed streams matched to the installed SDK.                    |
| 4    | Composer, Settings, and continuation                               | Check stale requests, settings round trip, draft retention, links, and workspace recovery using focused host and webview tests. Run the Docker visual workflow.                                 |
| 5    | Qualification                                                      | Model check, required test and lint gates, dead-code checks, and VSIX build and distribution tests. Live inference requires separate authorization.                                             |

## Review and recovery

The initial review identified separate ownership for native and Dory output, an explicit guard on the Dory history entry, and a shared scheduler for starts. Keep native start, navigation, stop, and clear serialized so a delayed start cannot outlive its selected task. Check the account and billing route before submitting input. A native turn result affects its projection. It does not complete the user's task. On interruption, close the process before releasing the writer reservation. Preserve records on failed startup and keep unknown versions readable. Disable native integration through its setup setting to stop new native work while keeping history available.

The checkout uses Node `22.23.4` available and declares pnpm `10.8.1`. Runtime model discovery, account scope, and process cleanup must be confirmed against the pinned executables. A runtime or policy mismatch keeps the native route unavailable. A failure at a wave boundary updates this record before dependent work proceeds.

The host verifies the selected route before each turn and uses one process per native turn. Approvals and answers are tied to the active task and native run. The transcript projection saves during streaming. A lost process never changes task completion status. Incomplete commands keep their checkout reservation until a user verifies shutdown.

## Qualification

- The repository test suite, lifecycle checks, type checks, lint, and the three dead-code checks passed. Focused host tests cover profile and model rejection, scoped approval denial, interruption without a final Codex notice, and native transcript ownership. Webview tests cover profile Save and stale state messages.
- The pinned Docker browser passed the composer snapshots and keyboard interaction at 320 pixels. The VS Code 1.100.0 mock smoke test passed extension activation and command registration on macOS.
- The VSIX packages the Claude SDK as a separate ES module. A CommonJS bundle cannot initialize the SDK's ES module dependencies. The distribution test imports the packaged module from an isolated directory. The extracted module also initialized Claude Code 2.1.284 without a prompt. Codex 0.159.0 passed direct account, configuration, and model discovery.
- Live model turns for both native engines and Linux native runtime execution remain unverified. The setup guide records a disposable-checkout smoke procedure. File recovery exports the pre-task snapshot for review and selective copying, with a linked handoff to reconcile the next conversation.
