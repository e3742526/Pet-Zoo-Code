import type * as vscode from "vscode"

import { ORGANIZATION_ALLOW_ALL, providerIdentifiers } from "@roo-code/types"

import { makeUri } from "../../../test-utils/vscode"
import { createCommitMessageCommands } from "../commands"
import { prepareCommitIndex, readStagedCommitDiff } from "../git"
import { DEFAULT_COMMIT_PROVIDER, draftCommitMessage } from "../providers"

const { getConfiguration, getExtension, showWarningMessage, showErrorMessage, showQuickPick, dispose } = vi.hoisted(
	() => ({
		getConfiguration: vi.fn(),
		getExtension: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showQuickPick: vi.fn(),
		dispose: vi.fn(),
	}),
)
const token: vscode.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: vi.fn(() => ({ dispose })),
}
vi.mock("vscode", () => ({
	extensions: { getExtension },
	workspace: {
		getConfiguration,
		isTrusted: true,
		workspaceFolders: [],
	},
	window: {
		showErrorMessage,
		showWarningMessage,
		showInformationMessage: vi.fn(),
		showQuickPick,
		withProgress: <T>(
			_opts: vscode.ProgressOptions,
			task: (progress: vscode.Progress<unknown>, token: vscode.CancellationToken) => Promise<T>,
		) => task({ report: vi.fn() }, token),
	},
	ConfigurationTarget: { Global: 1 },
	ProgressLocation: { Notification: 15 },
}))
vi.mock("../git", () => ({ prepareCommitIndex: vi.fn(), readStagedCommitDiff: vi.fn() }))
vi.mock("../providers", () => ({ DEFAULT_COMMIT_PROVIDER: "default", draftCommitMessage: vi.fn() }))

const repo = () => ({
	rootUri: makeUri("/repo"),
	inputBox: { value: "" },
	ui: { selected: true },
})
const outputChannel = { appendLine: vi.fn() }
const listConfig = vi.fn()
const getProfile = vi.fn()
const update = vi.fn()
const inspect = vi.fn()
const legacySettings = new Map<string, string>()
const commands = createCommitMessageCommands(
	{
		getState: async () => ({ currentApiConfigName: "API", organizationAllowList: ORGANIZATION_ALLOW_ALL }),
		providerSettingsManager: { listConfig, getProfile },
	},
	outputChannel,
)
const initialDiff = { patch: "+stage changes", fingerprint: "initial-diff" }
const message = "feat: stage changes"

beforeEach(() => {
	vi.resetAllMocks()
	legacySettings.clear()
	getConfiguration.mockImplementation((section: string) =>
		section === "dory.commitMessage" ? { get: (key: string) => legacySettings.get(key) } : { inspect, update },
	)
	vi.mocked(token.onCancellationRequested).mockReturnValue({ dispose })
	vi.mocked(prepareCommitIndex).mockResolvedValue("ready")
	vi.mocked(readStagedCommitDiff).mockResolvedValue(initialDiff)
	vi.mocked(draftCommitMessage).mockResolvedValue(message)
	listConfig.mockResolvedValue([])
})

function setRepositories(repositories: ReturnType<typeof repo>[]) {
	getExtension.mockReturnValue({
		activate: async () => ({
			enabled: true,
			getAPI: () => ({ git: { path: "/bin/git" }, repositories }),
		}),
	})
}

it("drafts into the repository identified by Source Control and honors its settings", async () => {
	const first = repo()
	const second = { ...repo(), rootUri: makeUri("/other") }
	legacySettings.set("provider", "omlx")
	inspect.mockImplementation((key: string) =>
		key === "provider" ? { workspaceFolderValue: "default" } : { globalValue: "never" },
	)
	setRepositories([first, second])

	await commands.generateCommitMessage({ rootUri: second.rootUri })

	expect(prepareCommitIndex).toHaveBeenCalledWith("/bin/git", "/other", "never", expect.any(AbortSignal))
	expect(draftCommitMessage).toHaveBeenCalledWith(
		expect.objectContaining({ selection: DEFAULT_COMMIT_PROVIDER, cwd: "/other" }),
	)
	expect(first.inputBox.value).toBe("")
	expect(second.inputBox.value).toBe(message)
	expect(dispose).toHaveBeenCalledOnce()
})

it.each(["input", "index"])("keeps the commit input when the %s changes during generation", async (changed) => {
	const target = repo()
	setRepositories([target])
	vi.mocked(draftCommitMessage).mockImplementation(async () => {
		if (changed === "input") target.inputBox.value = "A user edit"
		else vi.mocked(readStagedCommitDiff).mockResolvedValue({ ...initialDiff, fingerprint: "new-diff" })
		return message
	})
	await commands.generateCommitMessage()

	expect(target.inputBox.value).toBe(changed === "input" ? "A user edit" : "")
	expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("changed"))
	expect(showErrorMessage).not.toHaveBeenCalled()
})

it.each([DEFAULT_COMMIT_PROVIDER, "profile:removed-id"])(
	"loads profiles by ID and tolerates a profile removed during a %s draft",
	async (selection) => {
		const target = repo()
		setRepositories([target])
		inspect.mockImplementation((key: string) => (key === "provider" ? { globalValue: selection } : undefined))
		listConfig.mockResolvedValue([
			{ id: "removed-id", name: "API", apiProvider: providerIdentifiers.anthropic },
			{ id: "remaining-id", name: "Other", apiProvider: providerIdentifiers.openrouter },
		])
		const remainingProfile = { name: "Renamed", apiProvider: providerIdentifiers.openrouter }
		getProfile.mockImplementation(async ({ id }: { id: string }) => {
			if (id === "removed-id") throw new Error("Profile was removed")
			return remainingProfile
		})
		const automatic = selection === DEFAULT_COMMIT_PROVIDER
		vi.mocked(draftCommitMessage).mockResolvedValue(automatic ? message : undefined)

		await commands.generateCommitMessage()

		expect(getProfile.mock.calls).toEqual(
			automatic ? [[{ id: "removed-id" }], [{ id: "remaining-id" }]] : [[{ id: "removed-id" }]],
		)
		expect(draftCommitMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				selection,
				profiles: automatic ? [{ id: "remaining-id", settings: remainingProfile }] : [],
			}),
		)
		expect(target.inputBox.value).toBe(automatic ? message : "")
		expect(showErrorMessage).not.toHaveBeenCalled()
	},
)

it("lets the user select and save Default over a legacy pin", async () => {
	legacySettings.set("provider", "omlx")
	showQuickPick.mockImplementation(async (items: Array<vscode.QuickPickItem & { selection: string }>) =>
		items.find(({ selection }) => selection === DEFAULT_COMMIT_PROVIDER),
	)

	await commands.setCommitMessageProvider()

	expect(showQuickPick).toHaveBeenCalledWith(
		expect.arrayContaining([expect.objectContaining({ selection: "dory:omlx", detail: "Current selection" })]),
		expect.anything(),
	)
	expect(update).toHaveBeenCalledWith("provider", DEFAULT_COMMIT_PROVIDER, 1)
})
