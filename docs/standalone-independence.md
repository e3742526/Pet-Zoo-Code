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

The fork still has the `ZooCodeOrganization.zoo-code` installation identity. Schedule the identity and migration work before side-by-side distribution. Optional documentation links still point to Zoo Code.

## OpenRouter endpoint routing

On November 24, 2026, OpenRouter catalog and per-model endpoint discovery began using the profile's configured base URL. The host, webview, and disk caches keep results for each URL separate. A proxy that serves chat without OpenRouter discovery can use a manually configured model ID. Discovery requests remain unauthenticated and expect OpenRouter response formats.

The 338 focused host tests, 316 webview tests, and 44 distribution checks passed. Both host and webview bundles were rebuilt before packaging. The installed VSIX fetched both metadata responses from a loopback OpenRouter mock, used the pinned provider's output limit in a streamed task, and reopened the saved result. The process sandbox denied a non-loopback TCP connection.

## VSIX build inputs

On November 24, 2026, the VSCE prepublish hook began building the webview and the extension's workspace dependencies before bundling the production host. The same hook runs for the root `pnpm vsix` command, direct packaging, and both release workflows. The root task uses the workspace builds as cache inputs and skips the development host bundle.

A direct package from missing webview output rebuilt the assets. A second package used the build cache and replaced a stale marker in the generated webview. The root package cache restored a byte-identical archive after the output file was moved. Local stable and prerelease packages contained their respective manifests and bundles. All 21 build cache contract checks and 44 distribution tests passed.

## Decision on the proposed independence plan

Use the current fork as the operational baseline. Zoo Gateway inference, Zoo sign-in and billing, Roo Cloud, and both PostHog clients were removed before this review. A saved Zoo Gateway profile keeps its model and task history. Inference stops with a message to select another provider, and new exports omit the retired token. Local organization policy and the bundled mode and MCP catalog still work without a cloud service.

Keep Muse and Antigravity as selectable providers alongside direct APIs and local models. Both CLI handlers are registered. Their live authentication flows still need separate validation. An unconfigured profile uses the bundled model list. Task title generation can use the active task profile or a configured title profile, with a local fallback. Code indexing is disabled by default and uses its own configuration when enabled.

Use the local VSIX build for distribution during the transition. The manifest identifies the fork repository, and the CLI upgrade command uses releases from that repository. Marketplace publishing jobs still target the upstream repository. Local packaging needs no upstream publishing credentials. Keep the VS Code installation ID until a separate migration covers command and setting IDs, explicit import of profiles and history, and the OpenRouter and Requesty callbacks. The shared ID also means the current VSIX occupies the upstream extension's installation slot. Test side-by-side installation before distributing a separately identified build.

On November 24, 2026, the fork removed unused Zoo Pass copy and its link from all 18 webview locales. The distribution check caught the retired URL before the fix. The announcement keeps its release notes and user-opened links. The rebuilt VSIX passed the scan and matched the built host and webview scripts. An isolated VS Code profile started from that VSIX, discovered a model on a loopback OpenRouter mock, completed a streamed task, and reopened the saved task. The operating system rejected a non-loopback TCP connection from the extension host. These checks cover the packaged local workflow and the known retired URLs.

The focused host and webview suites passed 159 tests, the distribution passed 44 checks, and the announcement passed both browser checks in the pinned Playwright container. The previous screenshot showed the retired promotion. The new baseline shows the current release notes. Host and webview type checks and targeted lint checks passed. The VSIX build used Node 24.22.3.

## Provider request attribution

On November 24, 2026, the fork removed the default `HTTP-Referer` and `X-Title` headers from its shared provider headers, image requests, and OpenRouter embeddings. These headers previously identified the upstream Zoo Code application. The affected requests now use the versioned `PetZooCode` user agent. Configured headers take precedence where providers support them. The fork sends no app attribution by default. [OpenRouter app attribution](https://openrouter.ai/docs/app-attribution)

Eleven request assertions failed against the old headers. After the fix, 1,308 focused host tests and 44 distribution checks passed. Two OpenRouter tests passed in VS Code with a local mock. The rebuilt VSIX also completed and reopened a task under the loopback-only process sandbox. The mock received the versioned fork user agent and bearer credential. The request contained no app attribution headers.

## Separate VS Code installation

The `refactor/pet-zoo-extension-identity` worktree starts from `40c670769`. Its goal is a locally built `e3742526.pet-zoo-code` VSIX that can run in the same VS Code profile as `ZooCodeOrganization.zoo-code`. The publisher uses the fork repository owner's handle for local sideloading. Marketplace publication requires separate ownership verification. The current main worktree and the legacy VSIX provide the rollback path.

| Item                                   | Implementation and acceptance                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Separate registration and packaging | Align the manifest, commands, settings, views, diff URI scheme, developer IPC key, OAuth callback, and release and test tooling. Build the VSIX, install both packages in a temporary VS Code profile, and check separate activation, local settings and task history, and command routing.                     |
| 2. Explicit migration                  | Reuse settings import and extend the existing task-history copy flow for the former Zoo identity. Check source preservation, distinct destination storage, repeated import, and rejection of overlapping paths. Document reauthorization for subscription credentials and the handling of administrator policy. |

The legacy VSIX has the upstream publisher and sidebar ID. Changing either manifest field alone would leave conflicting command and configuration IDs. The first package must change those IDs together and keep the CLI and host test entry points aligned. VS Code scopes provider secrets and the default storage directory to the extension ID. The migration uses settings export and explicit task import. `.roo` project files, user-configured services, and API provider protocol identifiers retain their existing format.

The local policy environment variable applies to both versions. A cached organization policy belongs to the original VS Code extension state. Confirm ownership and policy handling before recommending migration of a managed installation. A custom storage root must be separate for each installed extension. Verify these boundaries before advancing the new identity to the default local distribution.

Item 1 is verified. On November 24, 2026, VS Code 1.147.0 installed both VSIX files in one temporary profile. Both sidebars activated and registered their own commands. The two settings namespaces returned different request timeouts. Each extension completed a local mock task, and each task appeared only in its own history. The fork reopened its saved task. The operating system rejected non-loopback TCP traffic from the test host.

The branch passed 349 focused checks across the host, webview, tooling, distribution, and VS Code suites. The archived manifest shows the new ID. The archived host and webview scripts match the build outputs. The fork README points to the local package. Verification uses a local publisher identifier, generated OAuth callback URLs, and mock inference. Live sign-in and migration from the former Zoo task store remain open under item 2. The candidate stays on the identity branch during that work.
