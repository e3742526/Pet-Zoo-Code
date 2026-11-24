import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
	changeLanguage: vi.fn(),
}))

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"
import { handleLegacyHistoryImport } from "../handleLegacyHistoryImport"

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
	workspace: {
		workspaceFolders: undefined,
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
			update: vi.fn(),
		})),
	},
	env: {
		clipboard: { writeText: vi.fn() },
		openExternal: vi.fn(),
	},
	commands: {
		executeCommand: vi.fn(),
	},
	Uri: {
		parse: vi.fn((s: string) => ({ toString: () => s })),
		file: vi.fn((p: string) => ({ fsPath: p })),
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
		WorkspaceFolder: 3,
	},
}))

const importLegacyTaskHistoryMock = vi.hoisted(() =>
	vi.fn<typeof import("../../task-persistence/importLegacyTaskHistory").importLegacyTaskHistory>(),
)
vi.mock("../../task-persistence/importLegacyTaskHistory", () => ({
	importLegacyTaskHistory: importLegacyTaskHistoryMock,
}))

import * as vscode from "vscode"

const makeProvider = () => ({
	contextProxy: { globalStorageUri: { fsPath: "/mock/storage" } },
	taskHistoryStore: {
		invalidateAll: vi.fn(),
		reconcile: vi.fn().mockResolvedValue(undefined),
	},
	postMessageToWebview: vi.fn().mockResolvedValue(undefined),
	postStateToWebview: vi.fn().mockResolvedValue(undefined),
	log: vi.fn(),
})

describe("legacy task history import", () => {
	let mockProvider: ReturnType<typeof makeProvider>
	let provider: ClineProvider

	beforeEach(() => {
		vi.clearAllMocks()
		mockProvider = makeProvider()
		// The handler uses the storage path, task history store, and messaging methods.
		provider = mockProvider as unknown as ClineProvider
	})

	it("refreshes imported Zoo tasks without sending Roo webview progress", async () => {
		importLegacyTaskHistoryMock.mockResolvedValue({
			sourceExtensionId: "ZooCodeOrganization.zoo-code",
			sourceStorageRoots: ["/mock/legacy-zoo"],
			destinationStorageRoot: "/mock/storage",
			foundTaskCount: 1,
			importedTaskCount: 1,
			importedFileCount: 2,
		})

		await handleLegacyHistoryImport(provider, "zoo")

		expect(importLegacyTaskHistoryMock).toHaveBeenCalledWith("/mock/storage", "zoo", undefined)
		expect(mockProvider.taskHistoryStore.reconcile).toHaveBeenCalledTimes(1)
		expect(mockProvider.postStateToWebview).toHaveBeenCalledTimes(1)
		expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("common:zooHistoryImport.success")
	})

	it("refreshes task history, streams progress, and shows a success message after importing Roo history", async () => {
		importLegacyTaskHistoryMock.mockImplementation(async (_globalStoragePath, _source, onProgress) => {
			await onProgress?.({
				copiedFileCount: 2,
				totalFileCount: 4,
				importedTaskCount: 1,
				totalTaskCount: 2,
				currentTaskId: "task-1",
				currentFileName: "ui_messages.json",
			})

			return {
				sourceExtensionId: "RooVeterinaryInc.roo-cline",
				sourceStorageRoots: ["/mock/roo-storage"],
				destinationStorageRoot: "/mock/storage",
				foundTaskCount: 2,
				importedTaskCount: 2,
				importedFileCount: 4,
			}
		})

		await webviewMessageHandler(provider, { type: "importRooHistory" })

		expect(importLegacyTaskHistoryMock).toHaveBeenCalledWith("/mock/storage", "roo", expect.any(Function))
		expect(mockProvider.taskHistoryStore.invalidateAll).toHaveBeenCalledTimes(1)
		expect(mockProvider.taskHistoryStore.reconcile).toHaveBeenCalledTimes(1)

		expect(mockProvider.postStateToWebview).toHaveBeenCalledTimes(1)
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(1, {
			type: "rooHistoryImportProgress",
			rooHistoryImportProgress: {
				status: "starting",
				copiedFileCount: 0,
				totalFileCount: 0,
				importedTaskCount: 0,
				totalTaskCount: 0,
			},
		})
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(2, {
			type: "rooHistoryImportProgress",
			rooHistoryImportProgress: {
				status: "copying",
				copiedFileCount: 2,
				totalFileCount: 4,
				importedTaskCount: 1,
				totalTaskCount: 2,
				currentTaskId: "task-1",
				currentFileName: "ui_messages.json",
			},
		})
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(3, {
			type: "rooHistoryImportProgress",
			rooHistoryImportProgress: {
				status: "finished",
				copiedFileCount: 4,
				totalFileCount: 4,
				importedTaskCount: 2,
				totalTaskCount: 2,
				currentTaskId: "task-1",
				currentFileName: "ui_messages.json",
			},
		})
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("common:info.rooHistoryImport.success")
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it("uses the singular success message when one Roo task history is imported", async () => {
		importLegacyTaskHistoryMock.mockResolvedValue({
			sourceExtensionId: "RooVeterinaryInc.roo-cline",
			sourceStorageRoots: ["/mock/roo-storage"],
			destinationStorageRoot: "/mock/storage",
			foundTaskCount: 1,
			importedTaskCount: 1,
			importedFileCount: 2,
		})

		await webviewMessageHandler(provider, { type: "importRooHistory" })

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("common:info.rooHistoryImport.success")
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(2, {
			type: "rooHistoryImportProgress",
			rooHistoryImportProgress: {
				status: "finished",
				copiedFileCount: 2,
				totalFileCount: 2,
				importedTaskCount: 1,
				totalTaskCount: 1,
			},
		})
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it("shows a 'not found' warning when no Roo history exists at all", async () => {
		importLegacyTaskHistoryMock.mockResolvedValue({
			sourceExtensionId: "RooVeterinaryInc.roo-cline",
			sourceStorageRoots: ["/mock/roo-storage"],
			destinationStorageRoot: "/mock/storage",
			foundTaskCount: 0,
			importedTaskCount: 0,
			importedFileCount: 0,
		})

		await webviewMessageHandler(provider, { type: "importRooHistory" })

		expect(importLegacyTaskHistoryMock).toHaveBeenCalledWith("/mock/storage", "roo", expect.any(Function))
		expect(mockProvider.taskHistoryStore.invalidateAll).not.toHaveBeenCalled()
		expect(mockProvider.taskHistoryStore.reconcile).not.toHaveBeenCalled()

		expect(mockProvider.postStateToWebview).not.toHaveBeenCalled()
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(2, {
			type: "rooHistoryImportProgress",
			rooHistoryImportProgress: {
				status: "finished",
				copiedFileCount: 0,
				totalFileCount: 0,
				importedTaskCount: 0,
				totalTaskCount: 0,
			},
		})
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("common:warnings.rooHistoryImport.nothingFound")
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
	})

	it("shows an 'already imported' warning when all Roo tasks are already in Zoo", async () => {
		importLegacyTaskHistoryMock.mockResolvedValue({
			sourceExtensionId: "RooVeterinaryInc.roo-cline",
			sourceStorageRoots: ["/mock/roo-storage"],
			destinationStorageRoot: "/mock/storage",
			foundTaskCount: 3,
			importedTaskCount: 0,
			importedFileCount: 0,
		})

		await webviewMessageHandler(provider, { type: "importRooHistory" })

		// History is refreshed even when nothing new was imported, so a retry
		// after a partial-copy failure still reconciles the store.
		expect(mockProvider.taskHistoryStore.invalidateAll).toHaveBeenCalledTimes(1)
		expect(mockProvider.taskHistoryStore.reconcile).toHaveBeenCalledTimes(1)

		expect(mockProvider.postStateToWebview).toHaveBeenCalledTimes(1)
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			"common:warnings.rooHistoryImport.alreadyImported",
		)
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
	})

	it("shows an error without refreshing task history when the import throws", async () => {
		importLegacyTaskHistoryMock.mockRejectedValue(new Error("permission denied"))

		await webviewMessageHandler(provider, { type: "importRooHistory" })

		expect(mockProvider.taskHistoryStore.invalidateAll).not.toHaveBeenCalled()
		expect(mockProvider.taskHistoryStore.reconcile).not.toHaveBeenCalled()

		expect(mockProvider.postStateToWebview).not.toHaveBeenCalled()
		expect(mockProvider.log).toHaveBeenCalledWith("[importLegacyHistory:roo] failed: permission denied")
		expect(mockProvider.postMessageToWebview).toHaveBeenNthCalledWith(2, {
			type: "rooHistoryImportProgress",
			rooHistoryImportProgress: {
				status: "failed",
				copiedFileCount: 0,
				totalFileCount: 0,
				importedTaskCount: 0,
				totalTaskCount: 0,
			},
		})
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.rooHistoryImport")
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})
})
