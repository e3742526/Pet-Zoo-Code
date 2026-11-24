import * as vscode from "vscode"
import * as path from "path"

import { listFiles } from "../../services/glob/list-files"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { toRelativePath, getWorkspacePath } from "../../utils/path"

const MAX_INITIAL_FILES = 1_000

// Note: this is not a drop-in replacement for listFiles at the start of tasks, since that will be done for Desktops when there is no workspace selected
class WorkspaceTracker {
	private providerRef: WeakRef<ClineProvider>
	private disposables: vscode.Disposable[] = []
	private filePaths: Set<string> = new Set()
	private filePathsChanged = false
	private updateTimer: NodeJS.Timeout | null = null
	private prevWorkSpacePath: string | undefined
	private resetTimer: NodeJS.Timeout | null = null

	get cwd() {
		return this.providerRef?.deref()?.cwd ?? getWorkspacePath()
	}
	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		this.registerListeners()
	}

	async initializeFilePaths() {
		const cwd = this.cwd
		// should not auto get filepaths for desktop since it would immediately show permission popup before cline ever creates a file
		if (!cwd) {
			return
		}
		const [files] = await listFiles(cwd, true, MAX_INITIAL_FILES)
		if (this.cwd !== cwd || this.prevWorkSpacePath !== cwd) {
			return
		}
		files.slice(0, MAX_INITIAL_FILES).forEach((file) => this.filePaths.add(this.normalizeFilePath(file)))
		this.workspaceDidUpdate()
	}

	private registerListeners() {
		const watcher = vscode.workspace.createFileSystemWatcher("**", false, true, false)
		this.prevWorkSpacePath = this.cwd
		this.disposables.push(
			watcher.onDidCreate(async (uri) => {
				await this.addFilePath(uri.fsPath)
				this.workspaceDidUpdate()
			}),
		)

		// Renaming files triggers a delete and create event
		this.disposables.push(
			watcher.onDidDelete(async (uri) => {
				if (await this.removeFilePath(uri.fsPath)) {
					this.workspaceDidUpdate()
				}
			}),
		)

		this.disposables.push(watcher)

		// Listen for tab changes and call workspaceDidUpdate directly
		this.disposables.push(
			vscode.window.tabGroups.onDidChangeTabs(() => {
				// Reset if workspace path has changed
				if (this.prevWorkSpacePath !== this.cwd) {
					this.workspaceDidReset()
				} else {
					this.workspaceDidUpdate(false)
				}
			}),
		)
	}

	private getOpenedTabsInfo() {
		return vscode.window.tabGroups.all.reduce(
			(acc, group) => {
				const groupTabs = group.tabs
					.filter((tab) => tab.input instanceof vscode.TabInputText)
					.map((tab) => ({
						label: tab.label,
						isActive: tab.isActive,
						path: toRelativePath((tab.input as vscode.TabInputText).uri.fsPath, this.cwd || ""),
					}))

				groupTabs.forEach((tab) => (tab.isActive ? acc.unshift(tab) : acc.push(tab)))
				return acc
			},
			[] as Array<{ label: string; isActive: boolean; path: string }>,
		)
	}

	private workspaceDidReset() {
		if (this.resetTimer) {
			clearTimeout(this.resetTimer)
		}
		this.resetTimer = setTimeout(() => {
			void this.resetWorkspace().catch((error) => {
				console.error("[WorkspaceTracker] Failed to reset workspace:", error)
			})
		}, 300) // Debounce for 300ms
	}

	private async resetWorkspace() {
		if (this.prevWorkSpacePath !== this.cwd) {
			await this.providerRef.deref()?.postMessageToWebview({
				type: "workspaceUpdated",
				filePaths: [],
				openedTabs: this.getOpenedTabsInfo(),
			})
			this.filePaths.clear()
			this.prevWorkSpacePath = this.cwd
			await this.initializeFilePaths()
		}
	}

	private workspaceDidUpdate(filePathsChanged = true) {
		// A tab event must not drop a file change already waiting for this timer.
		this.filePathsChanged ||= filePathsChanged
		if (this.updateTimer) {
			clearTimeout(this.updateTimer)
		}
		this.updateTimer = setTimeout(() => {
			this.updateTimer = null
			const cwd = this.cwd
			if (!cwd || this.prevWorkSpacePath !== cwd) {
				return
			}

			const fileUpdate = this.filePathsChanged
				? { filePaths: Array.from(this.filePaths, (file) => toRelativePath(file, cwd)) }
				: {}
			this.filePathsChanged = false
			void this.providerRef.deref()?.postMessageToWebview({
				type: "workspaceUpdated",
				...fileUpdate,
				openedTabs: this.getOpenedTabsInfo(),
			})
		}, 300) // Debounce for 300ms
	}

	private normalizeFilePath(filePath: string): string {
		const resolvedPath = this.cwd ? path.resolve(this.cwd, filePath) : path.resolve(filePath)
		return filePath.endsWith("/") ? resolvedPath + "/" : resolvedPath
	}

	private async addFilePath(filePath: string): Promise<string> {
		// Allow for some buffer to account for files being created/deleted during a task
		if (this.filePaths.size >= MAX_INITIAL_FILES * 2) {
			return filePath
		}

		const normalizedPath = this.normalizeFilePath(filePath)
		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(normalizedPath))
			const isDirectory = (stat.type & vscode.FileType.Directory) !== 0
			const pathWithSlash = isDirectory && !normalizedPath.endsWith("/") ? normalizedPath + "/" : normalizedPath
			this.filePaths.add(pathWithSlash)
			return pathWithSlash
		} catch {
			// If stat fails, assume it's a file (this can happen for newly created files)
			this.filePaths.add(normalizedPath)
			return normalizedPath
		}
	}

	private async removeFilePath(filePath: string): Promise<boolean> {
		const normalizedPath = this.normalizeFilePath(filePath)
		return this.filePaths.delete(normalizedPath) || this.filePaths.delete(normalizedPath + "/")
	}

	public dispose() {
		if (this.updateTimer) {
			clearTimeout(this.updateTimer)
			this.updateTimer = null
		}
		if (this.resetTimer) {
			clearTimeout(this.resetTimer)
			this.resetTimer = null
		}
		this.disposables.forEach((d) => d.dispose())
		this.disposables = [] // Clear the array
	}
}

export default WorkspaceTracker
