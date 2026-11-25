import * as vscode from "vscode"

import type { ClineProvider } from "../../core/webview/ClineProvider"
import { Package } from "../../shared/package"
import { prepareCommitIndex, readStagedCommitDiff, type AutoStage } from "./git"
import { DEFAULT_COMMIT_PROVIDER, draftCommitMessage, type CommitProfile } from "./providers"

interface GitRepository {
	rootUri: vscode.Uri
	inputBox: { value: string }
	ui: { selected: boolean }
}

interface GitApi {
	git: { path: string }
	repositories: GitRepository[]
}

interface GitExtension {
	enabled: boolean
	getAPI(version: 1): GitApi
}

type CommitMessageState = Pick<
	Awaited<ReturnType<ClineProvider["getState"]>>,
	"currentApiConfigName" | "organizationAllowList"
>

interface CommitMessageProvider {
	getState(options: { includeTaskHistory: false }): Promise<CommitMessageState>
	providerSettingsManager: Pick<ClineProvider["providerSettingsManager"], "listConfig" | "getProfile">
}

async function getGitApi(): Promise<GitApi | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>("vscode.git")
	const git = await extension?.activate()
	return git?.enabled ? git.getAPI(1) : undefined
}

async function selectRepository(repositories: GitRepository[], sourceControl?: Pick<vscode.SourceControl, "rootUri">) {
	const root = sourceControl?.rootUri
	if (root) return repositories.find((repo) => repo.rootUri.toString() === root.toString())
	if (repositories.length === 1) return repositories[0]

	const selected = repositories.filter((repo) => repo.ui.selected)
	if (selected.length === 1) return selected[0]

	const choice = await vscode.window.showQuickPick(
		repositories.map((repo) => ({
			label: vscode.workspace.asRelativePath(repo.rootUri),
			description: repo.rootUri.fsPath,
			repo,
		})),
		{ placeHolder: "Select a Git repository" },
	)
	return choice?.repo
}

function configuration(resource?: vscode.Uri) {
	return vscode.workspace.getConfiguration(`${Package.name}.commitMessage`, resource)
}

function readCommitSetting(
	key: string,
	fallback: string,
	resource?: vscode.Uri,
	useLegacy?: (value: string) => string,
) {
	const { workspaceFolderValue, workspaceValue, globalValue } = configuration(resource).inspect<string>(key) ?? {}
	const chosen = workspaceFolderValue ?? workspaceValue ?? globalValue
	if (typeof chosen === "string") return chosen
	const legacy = vscode.workspace.getConfiguration("dory.commitMessage", resource).get<string>(key)
	return typeof legacy === "string" ? (useLegacy?.(legacy) ?? legacy) : fallback
}

function readCommitProvider(resource?: vscode.Uri): string {
	return readCommitSetting("provider", DEFAULT_COMMIT_PROVIDER, resource, (legacy) =>
		legacy === "auto" ? DEFAULT_COMMIT_PROVIDER : `dory:${legacy}`,
	)
}

async function loadCommitProfiles(provider: CommitMessageProvider, selection: string, currentName?: string) {
	if (selection.startsWith("dory:")) return []
	const manager = provider.providerSettingsManager
	const entries = await manager.listConfig()
	entries.sort((a, b) => Number(b.name === currentName) - Number(a.name === currentName))
	const profiles: CommitProfile[] = []
	for (const { id, name, apiProvider } of entries) {
		if (!apiProvider || (selection !== DEFAULT_COMMIT_PROVIDER && selection !== `profile:${id}`)) continue
		profiles.push({ id, settings: await manager.getProfile({ name }) })
	}
	return profiles
}

async function draftInRepository(
	git: string,
	repo: GitRepository,
	provider: CommitMessageProvider,
	output: Pick<vscode.OutputChannel, "appendLine">,
) {
	const cwd = repo.rootUri.fsPath
	const originalInput = repo.inputBox.value
	const selection = readCommitProvider(repo.rootUri)
	const stageSetting = readCommitSetting("autoStage", "if-empty", repo.rootUri)
	const autoStage: AutoStage = stageSetting === "always" || stageSetting === "never" ? stageSetting : "if-empty"
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "Drafting commit message", cancellable: true },
		async (_progress, token) => {
			const controller = new AbortController()
			const { signal } = controller
			if (token.isCancellationRequested) controller.abort()
			const subscription = token.onCancellationRequested(() => controller.abort())
			try {
				const status = await prepareCommitIndex(git, cwd, autoStage, signal)
				switch (status) {
					case "clean":
						void vscode.window.showInformationMessage("The working tree is clean.")
						return
					case "conflicts":
						void vscode.window.showWarningMessage(
							"Resolve merge conflicts before you draft a commit message.",
						)
						return
					case "unstaged":
						void vscode.window.showInformationMessage("Stage changes before you draft a commit message.")
						return
				}

				const evidence = await readStagedCommitDiff(git, cwd, signal)
				if (!evidence.patch.trim()) {
					void vscode.window.showInformationMessage("Stage changes before you draft a commit message.")
					return
				}

				const { currentApiConfigName, organizationAllowList } = await provider.getState({
					includeTaskHistory: false,
				})
				const profiles = await loadCommitProfiles(provider, selection, currentApiConfigName)

				let indexChanged = false
				const checkIndex = async () => {
					const current = await readStagedCommitDiff(git, cwd, signal)
					indexChanged = current.fingerprint !== evidence.fingerprint
					return !indexChanged
				}
				const message = await draftCommitMessage({
					selection,
					profiles,
					allowList: organizationAllowList,
					patch: evidence.patch,
					cwd,
					signal,
					beforeDory: checkIndex,
					log: (message) => output.appendLine(`[Commit message] ${message}`),
				})
				signal.throwIfAborted()
				if (message) await checkIndex()
				signal.throwIfAborted()
				if (indexChanged || (message && repo.inputBox.value !== originalInput)) {
					void vscode.window.showWarningMessage(
						"The staged changes or commit input changed. Generate the message again.",
					)
				} else if (message) {
					repo.inputBox.value = message
				} else {
					void vscode.window.showWarningMessage(
						"Could not draft a commit message. Run Dory Code: Set Commit Message Provider to check your selection.",
					)
				}
			} catch (error) {
				if (!signal.aborted) throw error
			} finally {
				subscription.dispose()
			}
		},
	)
}

const doryChoices = [
	{ selection: "dory:auto", label: "Dory CLI", description: "Select a CLI agent automatically" },
	{ selection: "dory:codex", label: "Codex CLI" },
	{ selection: "dory:claude", label: "Claude CLI" },
	{ selection: "dory:gemini", label: "Gemini / Antigravity CLI" },
	{ selection: "dory:grok", label: "Grok Build CLI" },
	{ selection: "dory:mistral", label: "Mistral Vibe CLI" },
	{ selection: "dory:omlx", label: "oMLX (local)" },
]

export function createCommitMessageCommands(
	provider: CommitMessageProvider,
	output: Pick<vscode.OutputChannel, "appendLine">,
) {
	const pending = new Set<string>()

	return {
		generateCommitMessage: async (sourceControl?: Pick<vscode.SourceControl, "rootUri">) => {
			if (!vscode.workspace.isTrusted) {
				void vscode.window.showWarningMessage("Trust this workspace to generate a commit message.")
				return
			}

			let cwd: string | undefined
			try {
				const api = await getGitApi()
				if (!api?.repositories.length) {
					void vscode.window.showInformationMessage("Open a Git repository to generate a commit message.")
					return
				}
				const repo = await selectRepository(api.repositories, sourceControl)
				if (!repo) return
				const root = repo.rootUri.fsPath
				if (pending.has(root)) {
					void vscode.window.showInformationMessage(
						"Dory Code is already drafting a message for this repository.",
					)
					return
				}
				pending.add(root)
				cwd = root

				await draftInRepository(api.git.path, repo, provider, output)
			} catch {
				output.appendLine("[Commit message] Could not prepare or finish the draft.")
				void vscode.window.showErrorMessage(
					"Dory Code could not draft a commit message. Check the Git repository and try again.",
				)
			} finally {
				if (cwd) pending.delete(cwd)
			}
		},

		setCommitMessageProvider: async () => {
			try {
				const editor = vscode.window.activeTextEditor?.document.uri
				const folders = vscode.workspace.workspaceFolders
				const folder =
					(editor && vscode.workspace.getWorkspaceFolder(editor)) ??
					(folders?.length === 1 ? folders[0] : undefined)
				const resource = folder?.uri
				const current = readCommitProvider(resource)
				const profiles = await provider.providerSettingsManager.listConfig()
				const { organizationAllowList } = await provider.getState({ includeTaskHistory: false })
				const choices = [
					{
						label: "Default (Automatic)",
						description: "Signed-in services, then CLI agents, then API profiles",
						selection: DEFAULT_COMMIT_PROVIDER,
					},
					...profiles
						.filter(({ apiProvider, id }) => apiProvider && id)
						.map(({ name, apiProvider, id }) => ({
							label: name,
							description: apiProvider,
							selection: `profile:${id}`,
						})),
					...(organizationAllowList.allowAll
						? doryChoices.map((choice) => ({
								...choice,
								description: choice.description ?? "Requires the Dory CLI",
							}))
						: []),
				]
				const picked = await vscode.window.showQuickPick(
					choices.map((choice) => ({
						...choice,
						detail: choice.selection === current ? "Current selection" : undefined,
					})),
					{ title: "Set Commit Message Provider", placeHolder: "Select a provider for commit messages" },
				)
				if (!picked) return

				const targets = [{ label: "User", target: vscode.ConfigurationTarget.Global }]
				if (vscode.workspace.workspaceFolders?.length) {
					targets.unshift({ label: "Workspace", target: vscode.ConfigurationTarget.Workspace })
					if (folder && vscode.workspace.workspaceFile) {
						targets.unshift({ label: folder.name, target: vscode.ConfigurationTarget.WorkspaceFolder })
					}
				}
				const scope =
					targets.length === 1
						? targets[0]
						: await vscode.window.showQuickPick(targets, {
								placeHolder: "Select where to save the provider",
							})
				if (!scope) return

				await configuration(resource).update("provider", picked.selection, scope.target)
				void vscode.window.showInformationMessage(
					`Saved ${picked.label} for commit messages in ${scope.label} settings.`,
				)
			} catch {
				void vscode.window.showErrorMessage("Dory Code could not set the commit message provider.")
			}
		},
	}
}
