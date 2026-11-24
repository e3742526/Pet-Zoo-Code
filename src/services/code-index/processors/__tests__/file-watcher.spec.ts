// npx vitest services/code-index/processors/__tests__/file-watcher.spec.ts

import * as vscode from "vscode"
import type { Mocked } from "vitest"

import { FileWatcher } from "../file-watcher"
import { FilePreparation } from "../file-preparation"
import type { BatchProcessingSummary, IVectorStore } from "../../interfaces"

import { clearAllMocks } from "../../../../test-utils/reset"

// Mock TelemetryService
vi.mock("../../../../../packages/telemetry/src/TelemetryService", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Mock dependencies
vi.mock("../../cache-manager")
vi.mock("../../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: vi.fn().mockImplementation(function () {
		return {
			validateAccess: vi.fn().mockReturnValue(true),
		}
	}),
}))
vi.mock("ignore")
vi.mock("../parser", () => ({
	codeParser: {
		parseFile: vi.fn().mockImplementation(async (filePath: string) => [
			{
				file_path: filePath,
				content: "test content",
				start_line: 1,
				end_line: 1,
			},
		]),
	},
}))

const createMockEventEmitter = <T>() => {
	const listeners = new Set<(event: T) => void>()
	let disposed = false

	return {
		event: vi.fn((listener: (event: T) => void) => {
			if (!disposed) {
				listeners.add(listener)
			}
			return {
				dispose: () => listeners.delete(listener),
			}
		}),
		fire: vi.fn((event: T) => {
			for (const listener of listeners) {
				listener(event)
			}
		}),
		dispose: vi.fn(() => {
			disposed = true
			listeners.clear()
		}),
	}
}

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(),
		workspaceFolders: [
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		],
		fs: {
			stat: vi.fn().mockResolvedValue({ size: 1000 }),
			readFile: vi.fn().mockResolvedValue(Buffer.from("test content")),
		},
	},
	RelativePattern: vi.fn().mockImplementation(function (base, pattern) {
		return { base, pattern }
	}),
	Uri: {
		file: vi.fn().mockImplementation((path) => ({ fsPath: path })),
	},
	EventEmitter: vi.fn().mockImplementation(function () {
		return createMockEventEmitter()
	}),
	ExtensionContext: vi.fn(),
}))

describe("FileWatcher", () => {
	let fileWatcher: FileWatcher
	let mockWatcher: vscode.FileSystemWatcher
	let mockOnDidCreate: (uri: vscode.Uri) => void
	let mockOnDidChange: (uri: vscode.Uri) => void
	let mockOnDidDelete: (uri: vscode.Uri) => void
	let mockContext: any
	let mockCacheManager: any
	let mockEmbedder: any
	let mockVectorStore: Pick<Mocked<IVectorStore>, "upsertPoints" | "deletePointsByMultipleFilePaths">
	let mockIgnoreInstance: any

	const waitForNextBatch = () =>
		new Promise<BatchProcessingSummary>((resolve) => {
			const disposable = fileWatcher.onDidFinishBatchProcessing((summary) => {
				disposable.dispose()
				resolve(summary)
			})
		})

	const flushBatch = async () => {
		await vi.advanceTimersByTimeAsync(500)
	}

	beforeEach(() => {
		// Reset all mocks
		clearAllMocks()
		vi.useFakeTimers()

		// Create mock event handlers
		mockOnDidCreate = vi.fn()
		mockOnDidChange = vi.fn()
		mockOnDidDelete = vi.fn()

		vi.mocked(vscode.workspace.createFileSystemWatcher).mockImplementation(() => {
			mockWatcher = {
				ignoreCreateEvents: false,
				ignoreChangeEvents: false,
				ignoreDeleteEvents: false,
				onDidCreate: vi.fn<vscode.FileSystemWatcher["onDidCreate"]>().mockImplementation((handler) => {
					mockOnDidCreate = handler
					return { dispose: vi.fn() }
				}),
				onDidChange: vi.fn<vscode.FileSystemWatcher["onDidChange"]>().mockImplementation((handler) => {
					mockOnDidChange = handler
					return { dispose: vi.fn() }
				}),
				onDidDelete: vi.fn<vscode.FileSystemWatcher["onDidDelete"]>().mockImplementation((handler) => {
					mockOnDidDelete = handler
					return { dispose: vi.fn() }
				}),
				dispose: vi.fn(),
			}
			return mockWatcher
		})

		// Create mock dependencies
		mockContext = {
			subscriptions: [],
		}

		mockCacheManager = {
			getHash: vi.fn(),
			updateHash: vi.fn(),
			deleteHash: vi.fn(),
		}

		mockEmbedder = {
			createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
		}

		mockVectorStore = {
			upsertPoints: vi.fn().mockResolvedValue(undefined),
			deletePointsByMultipleFilePaths: vi.fn().mockResolvedValue(undefined),
		}

		mockIgnoreInstance = {
			ignores: vi.fn().mockReturnValue(false),
		}

		fileWatcher = new FileWatcher(
			"/mock/workspace",
			mockContext,
			mockCacheManager,
			mockEmbedder,
			// FileWatcher uses only the batch upsert and deletion methods on this double.
			mockVectorStore as unknown as IVectorStore,
			mockIgnoreInstance,
		)
	})

	afterEach(async () => {
		fileWatcher?.dispose()
		await vi.runOnlyPendingTimersAsync()
		vi.useRealTimers()
	})

	it("reuses constructor-created preparation for public processFile without writing points or cache", async () => {
		const prepare = vi.spyOn(FilePreparation.prototype, "prepareFile")
		try {
			const preparation = fileWatcher["filePreparation"]
			expect(preparation).toBeInstanceOf(FilePreparation)
			expect(preparation["dependencies"].fileSystem).toBe(vscode.workspace.fs)
			expect(preparation["dependencies"].cacheManager).toBe(mockCacheManager)
			expect(preparation["dependencies"].ignoreController).toBe(fileWatcher["ignoreController"])
			const path = "/mock/workspace/src/file.ts"
			const result = await fileWatcher.processFile(path)
			expect(prepare).toHaveBeenNthCalledWith(1, path)
			expect(result).toBe(await prepare.mock.results[0].value)
			expect(result.status).toBe("processed_for_batching")
			expect(result.pointsToUpsert).toHaveLength(1)
			expect(vscode.workspace.fs.stat).toHaveBeenCalledWith(vscode.Uri.file(path))
			expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(vscode.Uri.file(path))
			const secondPath = "/mock/workspace/src/second.ts"
			const secondResult = await fileWatcher.processFile(secondPath)
			expect(prepare).toHaveBeenCalledTimes(2)
			expect(prepare).toHaveBeenNthCalledWith(2, secondPath)
			expect(prepare.mock.contexts[0]).toBe(preparation)
			expect(prepare.mock.contexts[1]).toBe(preparation)
			expect(secondResult).toBe(await prepare.mock.results[1].value)
			expect(secondResult.status).toBe("processed_for_batching")
			expect(mockVectorStore.upsertPoints).not.toHaveBeenCalled()
			expect(mockCacheManager.updateHash).not.toHaveBeenCalled()
			expect(mockCacheManager.deleteHash).not.toHaveBeenCalled()
		} finally {
			prepare.mockRestore()
		}
	})

	describe("file filtering", () => {
		it("should ignore files in hidden directories on create events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			const batchPromise = waitForNextBatch()

			// Simulate file creation events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.git/config", shouldProcess: false },
				{ path: "/mock/workspace/.hidden/file.ts", shouldProcess: false },
				{ path: "/mock/workspace/src/.next/static/file.js", shouldProcess: false },
				{ path: "/mock/workspace/node_modules/package/index.js", shouldProcess: false },
				{ path: "/mock/workspace/normal/file.js", shouldProcess: true },
			]

			// Trigger file creation events
			for (const { path } of testCases) {
				mockOnDidCreate(vscode.Uri.file(path))
			}

			await flushBatch()

			const batchSummary = await batchPromise
			const successPaths = batchSummary.processedFiles
				.filter((result) => result.status === "success")
				.map((result) => result.path)
			const skippedPaths = batchSummary.processedFiles
				.filter((result) => result.status === "skipped")
				.map((result) => result.path)

			// Check that files in hidden directories were not processed
			expect(successPaths).toContain("/mock/workspace/src/file.ts")
			expect(successPaths).toContain("/mock/workspace/normal/file.js")
			expect(skippedPaths).toContain("/mock/workspace/.git/config")
			expect(skippedPaths).toContain("/mock/workspace/.hidden/file.ts")
			expect(skippedPaths).toContain("/mock/workspace/src/.next/static/file.js")
			expect(skippedPaths).toContain("/mock/workspace/node_modules/package/index.js")
		})

		it("should ignore files in hidden directories on change events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			const batchPromise = waitForNextBatch()

			// Simulate file change events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.vscode/settings.json", shouldProcess: false },
				{ path: "/mock/workspace/src/.cache/data.json", shouldProcess: false },
				{ path: "/mock/workspace/dist/bundle.js", shouldProcess: false },
			]

			// Trigger file change events
			for (const { path } of testCases) {
				mockOnDidChange(vscode.Uri.file(path))
			}

			await flushBatch()

			const batchSummary = await batchPromise
			const successPaths = batchSummary.processedFiles
				.filter((result) => result.status === "success")
				.map((result) => result.path)
			const skippedPaths = batchSummary.processedFiles
				.filter((result) => result.status === "skipped")
				.map((result) => result.path)

			// Check that files in hidden directories were not processed
			expect(successPaths).toContain("/mock/workspace/src/file.ts")
			expect(skippedPaths).toContain("/mock/workspace/.vscode/settings.json")
			expect(skippedPaths).toContain("/mock/workspace/src/.cache/data.json")
			expect(skippedPaths).toContain("/mock/workspace/dist/bundle.js")
		})

		it("should batch delete events after the debounce window", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			const deletedFiles: string[] = []
			mockVectorStore.deletePointsByMultipleFilePaths.mockImplementation(async (filePaths: string[]) => {
				deletedFiles.push(...filePaths)
			})
			const batchPromise = waitForNextBatch()

			// Simulate file deletion events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.git/objects/abc123", shouldProcess: false },
				{ path: "/mock/workspace/.DS_Store", shouldProcess: false },
				{ path: "/mock/workspace/build/.cache/temp.js", shouldProcess: false },
			]

			// Trigger file deletion events
			for (const { path } of testCases) {
				mockOnDidDelete(vscode.Uri.file(path))
			}

			await flushBatch()
			await batchPromise

			expect(deletedFiles).toEqual(testCases.map(({ path }) => path))
		})

		it("should handle nested hidden directories correctly", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			const batchPromise = waitForNextBatch()

			// Test deeply nested hidden directories
			const testCases = [
				{ path: "/mock/workspace/src/components/Button.tsx", shouldProcess: true },
				{ path: "/mock/workspace/src/.hidden/components/Button.tsx", shouldProcess: false },
				{ path: "/mock/workspace/.hidden/src/components/Button.tsx", shouldProcess: false },
				{ path: "/mock/workspace/src/components/.hidden/Button.tsx", shouldProcess: false },
			]

			// Trigger file creation events
			for (const { path } of testCases) {
				mockOnDidCreate(vscode.Uri.file(path))
			}

			await flushBatch()

			const batchSummary = await batchPromise
			const successPaths = batchSummary.processedFiles
				.filter((result) => result.status === "success")
				.map((result) => result.path)
			const skippedPaths = batchSummary.processedFiles
				.filter((result) => result.status === "skipped")
				.map((result) => result.path)

			// Check that files in hidden directories were not processed
			expect(successPaths).toContain("/mock/workspace/src/components/Button.tsx")
			expect(skippedPaths).toContain("/mock/workspace/src/.hidden/components/Button.tsx")
			expect(skippedPaths).toContain("/mock/workspace/.hidden/src/components/Button.tsx")
			expect(skippedPaths).toContain("/mock/workspace/src/components/.hidden/Button.tsx")
		})
	})

	describe("dispose", () => {
		it("publishes start, progress, and completion after reinitialization", async () => {
			const before = vscode.Uri.file("/mock/workspace/before.ts")
			const after = vscode.Uri.file("/mock/workspace/after.ts")
			const previousStart = vi.fn()
			const previousProgress = vi.fn()
			const previousFinish = vi.fn()
			fileWatcher.onDidStartBatchProcessing(previousStart)
			fileWatcher.onBatchProgressUpdate(previousProgress)
			fileWatcher.onDidFinishBatchProcessing(previousFinish)
			await fileWatcher.initialize()

			mockOnDidDelete(before)
			await flushBatch()
			expect(previousStart).toHaveBeenCalledWith([before.fsPath])
			expect(previousProgress).toHaveBeenCalledWith(expect.objectContaining({ currentFile: before.fsPath }))
			expect(previousFinish).toHaveBeenCalledOnce()

			fileWatcher.dispose()
			await fileWatcher.initialize()
			const currentStart = vi.fn()
			const currentProgress = vi.fn()
			const currentFinish = vi.fn()
			fileWatcher.onDidStartBatchProcessing(currentStart)
			fileWatcher.onBatchProgressUpdate(currentProgress)
			fileWatcher.onDidFinishBatchProcessing(currentFinish)
			previousProgress.mockClear()

			mockOnDidDelete(after)
			await flushBatch()

			expect(currentStart).toHaveBeenCalledWith([after.fsPath])
			expect(currentProgress).toHaveBeenCalledWith({
				processedInBatch: 1,
				totalInBatch: 1,
				currentFile: after.fsPath,
			})
			expect(currentFinish).toHaveBeenCalledWith({
				processedFiles: [{ path: after.fsPath, status: "success" }],
				batchError: undefined,
			})
			expect(previousStart).toHaveBeenCalledOnce()
			expect(previousProgress).not.toHaveBeenCalled()
			expect(previousFinish).toHaveBeenCalledOnce()
		})

		it("keeps queued events and native callbacks from a stopped watcher out of the next batch", async () => {
			await fileWatcher.initialize()
			await fileWatcher.initialize()
			expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledOnce()
			const firstWatcher = mockWatcher
			const oldDelete = mockOnDidDelete

			oldDelete(vscode.Uri.file("/mock/workspace/queued.ts"))
			fileWatcher.dispose()
			fileWatcher.dispose()
			expect(firstWatcher.dispose).toHaveBeenCalledOnce()
			expect(vi.getTimerCount()).toBe(0)

			await fileWatcher.initialize()
			oldDelete(vscode.Uri.file("/mock/workspace/stale.ts"))
			const current = vscode.Uri.file("/mock/workspace/current.ts")
			mockOnDidDelete(current)
			await flushBatch()

			expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2)
			expect(mockVectorStore.deletePointsByMultipleFilePaths.mock.calls).toEqual([[[current.fsPath]]])
		})

		it("keeps a batch on its original event channels when a start listener restarts the watcher", async () => {
			await fileWatcher.initialize()
			let finishDeletion!: () => void
			const pendingDeletion = new Promise<void>((resolve) => {
				finishDeletion = resolve
			})
			mockVectorStore.deletePointsByMultipleFilePaths.mockReturnValueOnce(pendingDeletion)
			const currentProgress = vi.fn()
			const currentFinish = vi.fn()
			let restarted: Promise<void> | undefined
			fileWatcher.onDidStartBatchProcessing(() => {
				fileWatcher.dispose()
				restarted = fileWatcher.initialize().then(() => {
					fileWatcher.onBatchProgressUpdate(currentProgress)
					fileWatcher.onDidFinishBatchProcessing(currentFinish)
				})
			})

			mockOnDidDelete(vscode.Uri.file("/mock/workspace/in-flight.ts"))
			await flushBatch()
			expect(restarted).toBeDefined()
			await restarted
			finishDeletion()
			await vi.advanceTimersByTimeAsync(0)

			expect(currentProgress).not.toHaveBeenCalled()
			expect(currentFinish).not.toHaveBeenCalled()

			const current = vscode.Uri.file("/mock/workspace/current.ts")
			mockOnDidDelete(current)
			await flushBatch()
			expect(currentProgress).toHaveBeenCalledWith(expect.objectContaining({ currentFile: current.fsPath }))
			expect(currentFinish).toHaveBeenCalledOnce()
		})

		it("reports deletion errors through the restarted watcher's batch notifications", async () => {
			await fileWatcher.initialize()
			fileWatcher.dispose()
			await fileWatcher.initialize()
			const file = vscode.Uri.file("/mock/workspace/deleted.ts")
			const error = new Error("Vector store unavailable")
			mockVectorStore.deletePointsByMultipleFilePaths.mockRejectedValueOnce(error)
			const progress = vi.fn()
			fileWatcher.onBatchProgressUpdate(progress)
			const finished = waitForNextBatch()

			mockOnDidDelete(file)
			await flushBatch()

			await expect(finished).resolves.toEqual({
				processedFiles: [{ path: file.fsPath, status: "error", error }],
				batchError: error,
			})
			expect(progress).toHaveBeenCalledWith({
				processedInBatch: 1,
				totalInBatch: 1,
				currentFile: file.fsPath,
			})
		})

		it("should dispose of the watcher when disposed", async () => {
			await fileWatcher.initialize()
			fileWatcher.dispose()

			expect(mockWatcher.dispose).toHaveBeenCalled()
		})
	})
})
