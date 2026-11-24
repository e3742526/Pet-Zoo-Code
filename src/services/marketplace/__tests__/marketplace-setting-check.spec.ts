// npx vitest services/marketplace/__tests__/marketplace-setting-check.spec.ts

import { webviewMessageHandler } from "../../../core/webview/webviewMessageHandler"
import type { ClineProvider } from "../../../core/webview/ClineProvider"
import type { MarketplaceManager } from "../MarketplaceManager"

const fetchMarketplaceData = vi.fn<ClineProvider["fetchMarketplaceData"]>()
const postStateToWebviewWithoutClineMessages = vi.fn<ClineProvider["postStateToWebviewWithoutClineMessages"]>()
const postMessageToWebview = vi.fn<ClineProvider["postMessageToWebview"]>()
// These routes use the provider to load the catalog or send installation results.
const mockProvider = {
	fetchMarketplaceData,
	postStateToWebviewWithoutClineMessages,
	postMessageToWebview,
} as unknown as ClineProvider

describe("Marketplace General Availability", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("loads the marketplace catalog on request", async () => {
		await webviewMessageHandler(mockProvider, { type: "fetchMarketplaceData" })

		expect(fetchMarketplaceData).toHaveBeenCalledOnce()
	})

	it("should allow marketplace installation (marketplace is generally available)", async () => {
		const mockInstallMarketplaceItem = vi
			.fn<MarketplaceManager["installMarketplaceItem"]>()
			.mockResolvedValue("/mock/mcp.json")
		// This route only uses the install method.
		const mockMarketplaceManagerWithInstall = {
			installMarketplaceItem: mockInstallMarketplaceItem,
		} as unknown as MarketplaceManager

		const message = {
			type: "installMarketplaceItem" as const,
			mpItem: {
				id: "test-item",
				name: "Test Item",
				type: "mcp" as const,
				description: "Test description",
				content: "test content",
				url: "https://example.com/test-mcp",
			},
			mpInstallOptions: { target: "project" as const },
		}

		await webviewMessageHandler(mockProvider, message, mockMarketplaceManagerWithInstall)

		// Should call install method since marketplace is generally available
		expect(mockInstallMarketplaceItem).toHaveBeenCalledWith(message.mpItem, message.mpInstallOptions)
		expect(postStateToWebviewWithoutClineMessages).toHaveBeenCalledOnce()
	})
})
