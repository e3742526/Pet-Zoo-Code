// npx vitest services/marketplace/__tests__/marketplace-setting-check.spec.ts

import { webviewMessageHandler } from "../../../core/webview/webviewMessageHandler"
import type { ClineProvider } from "../../../core/webview/ClineProvider"
import type { MarketplaceManager } from "../MarketplaceManager"

const postStateToWebviewWithoutClineMessages = vi.fn<ClineProvider["postStateToWebviewWithoutClineMessages"]>()
const postMessageToWebview = vi.fn<ClineProvider["postMessageToWebview"]>()
// These routes only use the provider to send state and action results.
const mockProvider = {
	postStateToWebviewWithoutClineMessages,
	postMessageToWebview,
} as unknown as ClineProvider

const updateWithFilteredItems = vi.fn<MarketplaceManager["updateWithFilteredItems"]>().mockResolvedValue([])
// The filter route uses only this marketplace method.
const mockMarketplaceManager = {
	updateWithFilteredItems,
} as unknown as MarketplaceManager

describe("Marketplace General Availability", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should allow marketplace API calls (marketplace is generally available)", async () => {
		const message = {
			type: "filterMarketplaceItems" as const,
			filters: { type: "mcp", search: "", tags: [] },
		}

		await webviewMessageHandler(mockProvider, message, mockMarketplaceManager)

		// Should call marketplace manager methods since marketplace is generally available
		expect(updateWithFilteredItems).toHaveBeenCalledWith({
			type: "mcp",
			search: "",
			tags: [],
		})
		expect(postStateToWebviewWithoutClineMessages).toHaveBeenCalledOnce()
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
