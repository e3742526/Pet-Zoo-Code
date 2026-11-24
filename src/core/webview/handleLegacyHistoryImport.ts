import * as vscode from "vscode"

import { t } from "../../i18n"
import {
	importLegacyTaskHistory,
	type LegacyHistoryImportProgress,
	type LegacyHistorySource,
} from "../task-persistence/importLegacyTaskHistory"
import type { ClineProvider } from "./ClineProvider"

export async function handleLegacyHistoryImport(provider: ClineProvider, source: LegacyHistorySource): Promise<void> {
	let latestProgress: LegacyHistoryImportProgress = {
		copiedFileCount: 0,
		totalFileCount: 0,
		importedTaskCount: 0,
		totalTaskCount: 0,
	}
	const postProgress = async (status: "starting" | "copying" | "finished" | "failed") => {
		if (source === "roo") {
			await provider.postMessageToWebview({
				type: "rooHistoryImportProgress",
				rooHistoryImportProgress: { status, ...latestProgress },
			})
		}
	}

	try {
		await postProgress("starting")

		const result = await importLegacyTaskHistory(
			provider.contextProxy.globalStorageUri.fsPath,
			source,
			source === "roo"
				? async (progress) => {
						latestProgress = progress
						await postProgress("copying")
					}
				: undefined,
		)

		if (result.foundTaskCount === 0) {
			await postProgress("finished")
			void vscode.window.showWarningMessage(
				t(
					source === "roo"
						? "common:warnings.rooHistoryImport.nothingFound"
						: "common:zooHistoryImport.nothingFound",
					{ domain: result.sourceExtensionId },
				),
			)
			return
		}

		// Reconcile on a retry even if the previous run already copied every task.
		await provider.taskHistoryStore.invalidateAll()
		await provider.taskHistoryStore.reconcile()
		await provider.postStateToWebview()
		latestProgress = {
			...latestProgress,
			copiedFileCount: result.importedFileCount,
			totalFileCount: latestProgress.totalFileCount || result.importedFileCount,
			importedTaskCount: result.importedTaskCount,
			totalTaskCount: latestProgress.totalTaskCount || result.foundTaskCount,
		}
		await postProgress("finished")

		if (result.importedTaskCount === 0) {
			void vscode.window.showWarningMessage(
				t(
					source === "roo"
						? "common:warnings.rooHistoryImport.alreadyImported"
						: "common:zooHistoryImport.nothingCopied",
					{ count: result.foundTaskCount },
				),
			)
		} else {
			void vscode.window.showInformationMessage(
				t(source === "roo" ? "common:info.rooHistoryImport.success" : "common:zooHistoryImport.success", {
					count: result.importedTaskCount,
				}),
			)
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		provider.log(`[importLegacyHistory:${source}] failed: ${message}`)
		await postProgress("failed")
		void vscode.window.showErrorMessage(
			t(source === "roo" ? "common:errors.rooHistoryImport" : "common:zooHistoryImport.failed", {
				error: message,
			}),
		)
	}
}
