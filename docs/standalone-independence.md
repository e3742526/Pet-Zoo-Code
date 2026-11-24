# Pet-Zoo-Code independence review

Review baseline `0f2b44050` on `main`. The supplied plan describes the runtime before the fork removed its upstream services. Use the current checkout as the baseline.

## Dependency inventory

| Surface                           | Current evidence                                                                                                                                                                                                          | Disposition                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Zoo Gateway, account, and billing | `1267ac754` removed the upstream runtime services. The provider factory keeps a retired handler for saved Gateway profiles. It reports retirement on an inference request and preserves the recorded model ID.            | Keep the retired handler and stored profiles.                                                                                 |
| Roo Cloud                         | `57bd4ce0a` removed the runtime package. `src/services/mdm/retainedOrganizationPolicy.ts` reads machine-supplied policy or the last policy in local storage.                                                              | Keep local restrictions.                                                                                                      |
| Analytics                         | The host starts `TelemetryService` with an empty client list. The webview and package manifests have no PostHog client. `d02aa29fc` checks the built host and webview for retired endpoints.                              | Keep local task events and usage accounting.                                                                                  |
| Marketplace                       | `src/services/marketplace/ConfigLoader.ts` reads bundled mode and MCP YAML files.                                                                                                                                         | Keep the bundled library. Installing an MCP server can use the configured service.                                            |
| Providers                         | `src/api/index.ts` registers Ollama, LM Studio, direct APIs, Muse, and Antigravity.                                                                                                                                       | Keep each provider selectable. A selected remote provider can require its own credentials and network access.                 |
| Distribution                      | The CLI uses the fork's releases after `0a9d6209a`. The stable and nightly Marketplace publish jobs restrict execution to the upstream repository. The local VSIX still uses `ZooCodeOrganization.zoo-code`.              | Use the local VSIX for runtime checks. Plan a separate installation identity before distributing the fork alongside Zoo Code. |
| Support                           | The diagnostic export and webview log mention upstream support. Unknown API errors link to an upstream mailbox. The VSIX lists the upstream repository and homepage. The fork has GitHub Issues and Discussions disabled. | Keep diagnostic details local and point package metadata to the fork.                                                         |

## Execution order

1. Qualify the local VSIX in an isolated VS Code profile and with outbound TCP limited to loopback. Check activation, webview hydration, a streamed task through a mock LM Studio endpoint, and task history. Use a denied non-loopback connection as a control. The bundle scan and this run answer different questions. The scan detects known endpoint strings, and the isolated run checks whether core features need an Internet connection.
2. Correct support and package metadata. Keep the diagnostic file local and instruct the user to review its contents before sharing. Unknown API errors should show local details. Check the diagnostic export and error row in their existing focused tests. Rebuild the VSIX and inspect the manifest inside it.
3. Plan any extension identity change with command, setting, storage, and OAuth migration. A change to publisher or name creates a separate VS Code extension ID. Check that old and new installations can coexist, and test explicit import with the settings and task data that users choose to transfer.

The first two items cover the requested operational separation. The plan keeps the current identity for existing installations and defers the separate product identity to item 3. Direct and local providers use the current factory. No task, secret, or policy migration is needed for items 1 and 2.

Review checks found two distinctions that affect the plan. Legacy provider compatibility must preserve history and refuse inference until the user selects a replacement. Support and documentation links require a user action, and a link to a public issue must never contain a diagnostic export or assistant conversation.

## Validation results

- Both the baseline and rebuilt VSIX installed into a temporary VS Code 1.147.0 profile. A macOS process sandbox limited outbound TCP to loopback. A connection from the extension host to the documentation address `192.0.2.1` returned `EPERM`.
- The installed extension activated and its sidebar hydrated. A local LM Studio mock served model discovery and streamed an `attempt_completion` tool call. The task appeared in history, and the extension reopened it with the persisted result.
- The rebuilt VSIX contains the fork repository and homepage. The archive integrity check passed, and its host and webview entry scripts match the build outputs.
- The five focused host suites passed 143 tests. The error row suite passed four tests. The built distribution passed 44 tests, including the retired endpoint scan in both bundles. Host and webview type checks and lint checks passed. The build used Node 24.22.3. The repository pins Node 22.23.4.

The isolated run covers local activation, inference, and task history. The bundle scan covers the known retired endpoint patterns. Live Muse and Antigravity authentication, a full network traffic inventory, and side-by-side installation remain untested. Separate identity work must resolve the VSIX manifest, configuration and command namespaces, OAuth callbacks, and migration before testing coexistence.

## Provider selection follow-up

On November 24, 2026, the webview model picker adopted the same bundled Anthropic catalog that the extension host uses when the provider is unset. Previously, the picker could request the public OpenRouter catalog for a profile with no provider. Explicit OpenRouter profiles still request their catalog. The change needs no profile or settings migration and can be reversed with the model picker commit.

Both regression tests failed before the change and passed after it. The 309 focused webview tests, 71 host tests, and 44 distribution checks passed. The rebuilt VSIX matched the host and webview build outputs. It activated in a temporary VS Code profile under a loopback-only process sandbox, completed a task through the LM Studio mock, and reopened the saved task. The non-loopback control returned `EPERM`.

The fork still has the `ZooCodeOrganization.zoo-code` installation identity. Schedule the identity and migration work before side-by-side distribution. Optional documentation links still point to Zoo Code. Model discovery for an explicitly selected OpenRouter profile can also use the public OpenRouter catalog when the profile configures a custom inference URL. That configuration needs a separate endpoint-routing check.
