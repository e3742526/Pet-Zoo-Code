import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { providerIdentifiers, type ExtensionMessage, type HistoryItem } from "@roo-code/types"

import { NativeAgentController } from "../NativeAgentController"
import type { NativeRuntime } from "../runtime"
import { TaskScheduler } from "../../task/TaskScheduler"
import type { ClineProvider } from "../../webview/ClineProvider"

const { openCodex } = vi.hoisted(() => ({ openCodex: vi.fn() }))
vi.mock("../codex", () => ({ openCodex }))
vi.mock("vscode", () => ({
	workspace: { isTrusted: true },
	env: {},
}))
vi.mock("../workspaceRecovery", () => ({ captureRecoveryPoint: async () => true }))

it("rejects stale connections, preserves native ownership, and denies pending approvals on Stop", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "dory-native-controller-"))
	const profile = {
		id: "p1",
		name: "Codex profile",
		apiProvider: providerIdentifiers.openaiCodex,
		apiModelId: "gpt-5.6-sol",
		nativeAgentAuth: "subscription",
		agentEngine: "codex",
	} as const
	const outbox: ExtensionMessage[] = []
	const history = new Map<string, HistoryItem>()
	const answer = vi.fn()
	const run: NativeRuntime["run"] = async (_nativeId, input, _images, events, bind) => {
		await bind("native-thread")
		await events.started()
		events.row({ id: "command", kind: "action", text: "A native command" })
		answer(await events.approval("Run command", input))
		return "interrupted"
	}
	const logToWebview = (message: ExtensionMessage) => {
		outbox.push(message)
		return Promise.resolve()
	}
	const provider = {
		cwd: directory,
		context: { globalStorageUri: { fsPath: directory } },
		getState: async () => ({
			currentApiConfigName: profile.name,
			apiConfiguration: profile,
			organizationAllowList: { allowAll: true, providers: {} },
		}),
		getCurrentTask: () => undefined,
		providerSettingsManager: { getProfile: async () => profile },
		taskHistoryStore: {
			get: (id: string) => history.get(id),
			atomicReadAndUpdate: async (id: string, update: (item: HistoryItem) => HistoryItem) => {
				const item = history.get(id)
				if (item) history.set(id, update(item))
			},
		},
		updateTaskHistory: async (item: HistoryItem) => {
			history.set(item.id, item)
		},
		postMessageToWebview: logToWebview,
		postStateToWebviewWithoutTaskHistory: async () => {},
		createTask: vi.fn(),
	}
	// Supplies the controller's profile, task-history, scheduling, and webview boundaries.
	const controller = new NativeAgentController(provider as unknown as ClineProvider, new TaskScheduler())
	const stop = vi.fn(async () => {})
	openCodex.mockImplementation(
		async () =>
			({
				identity: { accountScope: "account", version: "0.159.0", images: true },
				run,
				stop,
				close: async () => {},
			}) satisfies NativeRuntime,
	)
	try {
		await controller.handle({ kind: "discover", profileId: profile.id, model: "other" }, "stale")
		expect(outbox.at(-1)?.nativeAgentResult?.error).toMatch(/changed/)
		expect(openCodex).not.toHaveBeenCalled()

		await controller.handle({ kind: "discover", profileId: profile.id, model: profile.apiModelId }, "ready")
		const selection = outbox.at(-1)?.nativeAgentResult?.availability?.selection
		expect(selection).toBeDefined()
		const submission = {
			kind: "send",
			profileId: profile.id,
			model: profile.apiModelId,
			text: "Check the repository",
			images: [],
			hasAttachments: false,
		}
		await controller.handle({ ...submission, selection: "forged" }, "forged")
		expect(outbox.at(-1)?.nativeAgentResult?.error).toMatch(/changed/)
		expect(history.size).toBe(0)

		await controller.handle({ ...submission, selection }, "start")
		await vi.waitFor(() => expect(controller.view?.status).toBe("approval"))
		const taskId = controller.view?.taskId
		const approvalId = controller.view?.approval?.id
		expect(history.get(taskId ?? "")).toMatchObject({
			engine: "codex",
			nativeTurnState: "running",
			nativeSession: { nativeId: "native-thread" },
		})
		await controller.handle({ kind: "approve", taskId, approvalId: "stale", allow: true }, "stale-approval")
		expect(answer).not.toHaveBeenCalled()
		await controller.handle({ kind: "stop", taskId }, "stop")
		expect(stop).toHaveBeenCalledOnce()
		expect(answer).toHaveBeenCalledExactlyOnceWith(false)
		expect(history.get(taskId ?? "")?.nativeTurnState).toBe("stopped")
		await controller.handle({ kind: "approve", taskId, approvalId, allow: true }, "replayed-approval")
		expect(answer).toHaveBeenCalledTimes(1)
		expect(provider.createTask).not.toHaveBeenCalled()
	} finally {
		await controller.clear()
		await rm(directory, { recursive: true, force: true })
	}
})
