# Agent engines

Dory runs its own tools, modes, and task controls by default. A supported provider profile also lets you run Codex or Claude Agent in the Dory composer. Each native engine uses its own tool and session controls.

## Set up a native engine

Use a trusted local workspace on macOS or Linux. Install the matching CLI and make it available on the extension host's PATH. When VS Code cannot find the executable, open VS Code from a shell that can run the CLI.

| Profile       | Native engine | CLI version         | Billing route                                                                                                       |
| ------------- | ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| OpenAI Codex  | Codex         | Codex CLI 0.159.0   | Sign in to Codex with your ChatGPT account. Usage goes to that account and workspace.                               |
| OpenAI Native | Codex         | Codex CLI 0.159.0   | Select direct OpenAI API billing. Codex uses the API key saved for this profile.                                    |
| Anthropic     | Claude Agent  | Claude Code 2.1.284 | Sign in to Claude Code with your Claude account, or select direct Anthropic API billing and supply the profile key. |

The VSIX includes Claude Agent SDK 0.3.284. Both CLI executables come from the user installation. Dory uses the Anthropic-published executable with the user's own account or key. Anthropic's terms apply to the usage and distribution. See the [Claude Code legal and compliance guidance](https://code.claude.com/docs/en/legal-and-compliance).

1. Open **Settings → Providers** and select a direct provider profile from the table.
2. Under **Native agent billing**, select the route and save. For a subscription, sign in through the native CLI on the same host. For API billing, enter the key in the provider profile.
3. Start a new Dory task. Under the prompt, select **Codex** or **Claude Agent**. Check the model, profile, and billing route before sending. A setup message and **Check setup** action are available when the runtime cannot use that connection.
4. Use **Stop** to interrupt the turn. Dory accepts one turn at a time for a native task. Unsent text stays in the prompt box. Reopen the task from history and send a new message to resume that native session.

The setting applies to new tasks for the selected profile. To disable native sessions for a profile, select **Dory** in a new task, then set **Native agent billing** to **Use Dory only** and save. Native history remains readable. To resume a native task, restore its original connection and runtime.

## Continue and review files

**Continue with Codex**, **Continue with Claude Agent**, and **Continue with Dory** open a handoff review for a new linked task. Dory stops the old run before it prepares the handoff. Review the objective, base revision, and current checkout status. Add the checks and results you want the next engine to know. Select **Start linked task** when the target model and connection are correct. You can open the source and destination tasks from their history links.

Use **Review changes** to check the original and current checkout status and tracked Git changes. Where the checkpoint service can capture a snapshot, **Export recovery files** saves a ZIP of the pre-task files outside the checkout. Review the files and copy back only what you need. Then use a linked continuation with an updated handoff so the next agent has the corrected file state. The archive follows Dory's checkpoint exclusions. It contains file contents and does not record index staging.

If a process stops while a command might still be running, Dory keeps a checkout reservation. Stop the remaining process and check the checkout before starting another task there. On macOS or Linux, the reservation directory is in the extension host's temporary directory under `dory-agent-writers-*`. Each reservation's `owner.json` identifies the checkout. Remove a stale reservation only after you confirm the old task and its child processes have stopped.

## Native controls

| Control                       | Native behavior                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text and prompt shortcuts     | Send plain prompt text. Dory context mentions and slash commands must be removed before Send.                                                                                                    |
| Images                        | Use supported PNG, JPEG, GIF, or WebP images. Codex checks the selected model's catalog capabilities.                                                                                            |
| Tools and approvals           | The native runtime runs its tools. Dory displays native actions and can answer supported approval requests. **Allow once** applies to one request.                                               |
| Modes and custom instructions | Native presets and native repository instructions apply. Dory mode switching, custom system instructions, and automatic approval controls apply to the Dory engine.                              |
| Isolation                     | Codex starts in workspace-write with network access outside its sandbox subject to native review. Claude uses its default native permissions. A permission dialog does not create a sandbox.     |
| MCP and delegation            | Codex can use its native configuration. Claude uses strict MCP configuration and disables subagent and plan-mode tools in this integration. Dory MCP and its task-delegation tools are separate. |
| Questions                     | Claude Agent can request answers through its native user-input tool. The stable Codex connection supports its command and file approval requests.                                                |
| Resume and checkpoints        | A task resumes its saved native thread or session. Dory's per-tool checkpoint rewind and native conversation forking are unavailable in these controls.                                          |
| Usage                         | Native usage shown in the task comes from the runtime. Dory does not calculate a charge from those counters.                                                                                     |
| Other model calls             | Native tasks use a local title derived from the prompt. Prompt enhancement is unavailable. The source-control commit-message command uses its own configured provider.                           |

## Verify and maintain

The [architecture decision record](architecture/adr/0006-native-agent-sessions.md) describes the scheduler, history, and process boundaries. Run focused host tests from `src` and composer tests from `webview-ui` before changing the integration. Use the pinned Docker renderer for the composer baseline.

For a Codex update, run `codex app-server generate-ts --out <scratch-directory>` with the proposed executable. Compare the stable types for initialization, config, account, model listing, thread start, explicit resume, turn history, turn start, interruption, and server requests with the validators in the adapter. Update the fake-process scenarios when the wire shape changes. For a Claude update, compare the installed SDK types, check initialization and account metadata without sending a prompt, and check the published CLI compatibility and terms.

For a live smoke test, use a disposable trusted Git checkout and an authorized account. Run the workflow separately with each engine. Ask the engine to inspect a tracked file, make one simple edit, and run a local check. Deny a requested action and confirm the checkout does not contain that action's change. Start another turn, stop it, and reopen the same task from history. Confirm the displayed model, connection, and billing route before resuming. Test an image separately if the selected model supports it. Record the tool versions and results. Keep credentials and prompts out of the test record.
