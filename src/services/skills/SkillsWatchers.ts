// Own the VS Code watchers for skill roots and symlinked containers.
// Extracted from SkillsManager.ts.

import * as path from "path"
import * as vscode from "vscode"
import { isHiddenEntry } from "./skillDiscovery"

// Direct children (new skill folders or container symlinks) and their SKILL.md files.
const SKILLS_WATCH_PATTERN = "{*,*/SKILL.md}"

export class SkillsWatchers {
	private disposables: vscode.Disposable[] = []
	// Keyed by container real path. VS Code watchers don't follow symlinks.
	private containerWatchers: Map<string, vscode.Disposable> = new Map()

	constructor(
		private readonly isDisposed: () => boolean,
		private readonly onChange: () => Promise<void>,
	) {}

	watchDirectory(dirPath: string): void {
		const watcher = this.createSkillsWatcher(dirPath)
		if (watcher) {
			this.disposables.push(watcher)
		}
	}

	syncContainers(containers: ReadonlyMap<string, string>): void {
		for (const [containerPath, watcher] of this.containerWatchers) {
			if (this.isDisposed() || !containers.has(containerPath)) {
				watcher.dispose()
				this.containerWatchers.delete(containerPath)
			}
		}

		if (this.isDisposed()) return

		for (const containerPath of containers.keys()) {
			if (this.containerWatchers.has(containerPath)) continue
			const watcher = this.createSkillsWatcher(containerPath)
			if (watcher) {
				this.containerWatchers.set(containerPath, watcher)
			}
		}
	}

	private createSkillsWatcher(dirPath: string): vscode.Disposable | undefined {
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return undefined
		}

		const pattern = new vscode.RelativePattern(dirPath, SKILLS_WATCH_PATTERN)
		const watcher = vscode.workspace.createFileSystemWatcher(pattern)

		const onEvent = async (uri: vscode.Uri) => {
			if (this.isDisposed()) return
			// Skip hidden entries, such as the staging and trash dirs of a cross-filesystem move
			const relativePath = path.relative(dirPath, uri.fsPath)
			if (relativePath.split(path.sep).some(isHiddenEntry)) return
			await this.onChange()
		}

		watcher.onDidChange(onEvent)
		watcher.onDidCreate(onEvent)
		watcher.onDidDelete(onEvent)

		return watcher
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.containerWatchers.forEach((w) => w.dispose())
		this.containerWatchers.clear()
	}
}
