// npx vitest run services/mcp/__tests__/McpServerManager.spec.ts

import type * as vscode from "vscode"

import type { ClineProvider } from "../../../core/webview/ClineProvider"

const { hubs, readiness } = vi.hoisted(() => ({
	hubs: [] as Array<{ disposed: boolean; dispose: ReturnType<typeof vi.fn> }>,
	readiness: { wait: (): Promise<void> => Promise.resolve() },
}))

vi.mock("../McpHub", () => ({
	McpHub: class {
		disposed = false
		dispose = vi.fn(async () => {
			this.disposed = true
		})
		constructor() {
			hubs.push(this)
		}
		waitUntilReady() {
			return readiness.wait()
		}
	},
}))

vi.mock("../SecretStorageService", () => ({
	SecretStorageService: class {},
}))

// The manager reads and writes only `globalState.update` on the context.
const context = { globalState: { update: vi.fn().mockResolvedValue(undefined) } } as unknown as vscode.ExtensionContext
// The manager stores the provider and passes it to the hub mock, which ignores it.
const provider = {} as ClineProvider

async function loadManager() {
	vi.resetModules()
	const { McpServerManager } = await import("../McpServerManager")
	return McpServerManager
}

describe("McpServerManager", () => {
	beforeEach(() => {
		hubs.length = 0
		readiness.wait = () => Promise.resolve()
	})

	it("reuses a live hub", async () => {
		const McpServerManager = await loadManager()

		const first = await McpServerManager.getInstance(context, provider)
		const second = await McpServerManager.getInstance(context, provider)

		expect(second).toBe(first)
		expect(hubs).toHaveLength(1)
	})

	it("creates a new hub after the last client disposed the old one", async () => {
		const McpServerManager = await loadManager()

		const first = await McpServerManager.getInstance(context, provider)
		await first.dispose()
		const second = await McpServerManager.getInstance(context, provider)

		expect(second).not.toBe(first)
		expect(second.disposed).toBe(false)
		expect(hubs).toHaveLength(2)
	})

	it("disposes a hub that is still starting when cleanup runs", async () => {
		const McpServerManager = await loadManager()
		let finishStart: () => void = () => {}
		readiness.wait = () => new Promise<void>((resolve) => (finishStart = resolve))

		const starting = McpServerManager.getInstance(context, provider)
		const cleanup = McpServerManager.cleanup(context)
		finishStart()
		await cleanup
		const hub = await starting

		expect(hub.dispose).toHaveBeenCalledTimes(1)
		expect(hub.disposed).toBe(true)
	})
})
