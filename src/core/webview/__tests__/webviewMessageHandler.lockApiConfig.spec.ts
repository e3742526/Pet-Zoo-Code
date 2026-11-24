import type { ClineProvider } from "../ClineProvider"
import { webviewMessageHandler } from "../webviewMessageHandler"

describe("webviewMessageHandler - lockApiConfigAcrossModes", () => {
	it.each([true, false])("stores %s and refreshes settings without updating individual modes", async (enabled) => {
		const update = vi.fn<ClineProvider["context"]["workspaceState"]["update"]>().mockResolvedValue(undefined)
		const setModeConfig = vi.fn<ClineProvider["providerSettingsManager"]["setModeConfig"]>()
		const postStateToWebviewWithoutClineMessages = vi.fn<ClineProvider["postStateToWebviewWithoutClineMessages"]>()
		// The double provides workspace settings, the mode config writer, and the settings reply.
		const provider = {
			context: { workspaceState: { update } },
			providerSettingsManager: { setModeConfig },
			postStateToWebviewWithoutClineMessages,
		} as unknown as ClineProvider

		await webviewMessageHandler(provider, { type: "lockApiConfigAcrossModes", bool: enabled })

		expect(update).toHaveBeenCalledWith("lockApiConfigAcrossModes", enabled)
		expect(setModeConfig).not.toHaveBeenCalled()
		expect(postStateToWebviewWithoutClineMessages).toHaveBeenCalledOnce()
	})
})
