import {
	MarketplaceViewStateManager,
	ViewStateTransition,
	type StateChangeHandler,
} from "../MarketplaceViewStateManager"
import { MarketplaceItem } from "@roo-code/types"
import { vscode } from "@/utils/vscode"

// Mock vscode module
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

describe("MarketplaceViewStateManager", () => {
	let stateManager: MarketplaceViewStateManager
	let mockStateChangeHandler: ReturnType<typeof vi.fn<StateChangeHandler>>

	const mockMarketplaceItems: MarketplaceItem[] = [
		{
			id: "test-mcp-1",
			name: "Test MCP Server 1",
			description: "A test MCP server",
			type: "mcp",
			url: "https://example.com/test-mcp-1",
			content: "test content",
			tags: ["test", "mcp"],
		},
		{
			id: "test-mode-1",
			name: "Test Mode 1",
			description: "A test mode",
			type: "mode",
			content: "test content",
			tags: ["test", "mode"],
		},
		{
			id: "test-mcp-2",
			name: "Test MCP Server 2",
			description: "Another test MCP server",
			type: "mcp",
			url: "https://example.com/test-mcp-2",
			content: "test content",
			tags: ["test", "server"],
		},
	]

	beforeEach(() => {
		stateManager = new MarketplaceViewStateManager()
		mockStateChangeHandler = vi.fn<StateChangeHandler>()
		stateManager.onStateChange(mockStateChangeHandler)
	})

	afterEach(() => {
		stateManager.cleanup()
		vi.clearAllMocks()
	})

	describe("initialization", () => {
		it("should initialize with default state", () => {
			const state = stateManager.getState()

			expect(state.allItems).toEqual([])
			expect(state.displayItems).toEqual([])
			expect(state.isFetching).toBe(true)
			expect(state.activeTab).toBe("mcp")
			expect(state.filters).toEqual({
				type: "",
				search: "",
				tags: [],
				installed: "all",
			})
		})

		it("should ensure displayItems is never undefined in getState", () => {
			const state = stateManager.getState()

			expect(state.displayItems).toBeDefined()
			expect(Array.isArray(state.displayItems)).toBe(true)
		})
	})

	describe("displayItems initialization fix", () => {
		it("should fall back to allItems when displayItems is undefined", () => {
			// Simulate the scenario where displayItems might be undefined
			const transition: ViewStateTransition = {
				type: "FETCH_COMPLETE",
				payload: { items: mockMarketplaceItems },
			}

			stateManager.transition(transition)
			const state = stateManager.getState()

			// Verify that displayItems is properly initialized with allItems when no filters are active
			expect(state.displayItems).toEqual(mockMarketplaceItems)
			expect(state.allItems).toEqual(mockMarketplaceItems)
		})

		it("should ensure displayItems defaults to allItems when no filters are active", async () => {
			// Handle message with marketplace items (simulating the fix scenario)
			const message = {
				type: "state",
				state: {
					marketplaceItems: mockMarketplaceItems,
				},
			}

			await stateManager.handleMessage(message)
			const state = stateManager.getState()

			// Verify the fix: displayItems should equal allItems when no filters are active
			expect(state.displayItems).toEqual(mockMarketplaceItems)
			expect(state.allItems).toEqual(mockMarketplaceItems)
			expect(state.displayItems?.length).toBeGreaterThan(0)
		})

		it("should prevent marketplace blanking by ensuring displayItems is never empty when allItems has content", async () => {
			// This test specifically addresses the bug described in the PR
			const message = {
				type: "state",
				state: {
					marketplaceItems: mockMarketplaceItems,
				},
			}

			await stateManager.handleMessage(message)
			const state = stateManager.getState()

			// The key fix: displayItems should never be empty when allItems has content and no filters are active
			expect(state.allItems.length).toBeGreaterThan(0)
			expect(state.displayItems?.length).toBeGreaterThan(0)
			expect(state.displayItems).toEqual(state.allItems)
		})
	})

	describe("state change notifications", () => {
		it("should notify handlers when marketplace items are loaded", async () => {
			const message = {
				type: "state",
				state: {
					marketplaceItems: mockMarketplaceItems,
				},
			}

			await stateManager.handleMessage(message)

			expect(mockStateChangeHandler).toHaveBeenCalled()
			const notifiedState = mockStateChangeHandler.mock.calls[0][0]
			expect(notifiedState.allItems).toEqual(mockMarketplaceItems)
			expect(notifiedState.displayItems).toEqual(mockMarketplaceItems)
		})

		it("should prevent infinite loops by properly handling initial state", async () => {
			// Simulate multiple rapid state updates that could cause infinite loops
			const message1 = {
				type: "state",
				state: {
					marketplaceItems: [],
				},
			}

			const message2 = {
				type: "state",
				state: {
					marketplaceItems: mockMarketplaceItems,
				},
			}

			await stateManager.handleMessage(message1)
			await stateManager.handleMessage(message2)

			// Should have been called twice, not infinitely
			expect(mockStateChangeHandler).toHaveBeenCalledTimes(2)

			const finalState = stateManager.getState()
			expect(finalState.displayItems).toEqual(mockMarketplaceItems)
		})
	})

	describe("filtering behavior", () => {
		beforeEach(async () => {
			await stateManager.handleMessage({
				type: "marketplaceData",
				marketplaceItems: mockMarketplaceItems,
				marketplaceInstalledMetadata: {
					project: { "test-mcp-1": { type: "mcp" } },
					global: { "test-mode-1": { type: "mode" } },
				},
			})
		})

		it("should show all items when no filters are active", () => {
			const state = stateManager.getState()

			expect(stateManager.isFilterActive()).toBe(false)
			expect(state.displayItems).toEqual(mockMarketplaceItems)
		})

		it.each([
			{ filters: { type: "mcp" }, visibleIds: ["test-mcp-1", "test-mcp-2"] },
			{ filters: { search: "MODE" }, visibleIds: ["test-mode-1"] },
			{ filters: { search: "Another" }, visibleIds: ["test-mcp-2"] },
			{ filters: { search: "nonexistent" }, visibleIds: [] },
			{ filters: { tags: ["server"] }, visibleIds: ["test-mcp-2"] },
			{ filters: { installed: "installed" as const }, visibleIds: ["test-mcp-1", "test-mode-1"] },
			{ filters: { installed: "not_installed" as const }, visibleIds: ["test-mcp-2"] },
			{ filters: { type: "mcp", search: "test", tags: ["server"] }, visibleIds: ["test-mcp-2"] },
		])("applies $filters locally and clears it without contacting the host", async ({ filters, visibleIds }) => {
			await stateManager.transition({ type: "UPDATE_FILTERS", payload: { filters } })

			expect(stateManager.isFilterActive()).toBe(true)
			expect(stateManager.getState().displayItems?.map((item) => item.id)).toEqual(visibleIds)

			await stateManager.transition({
				type: "UPDATE_FILTERS",
				payload: { filters: { type: "", search: "", tags: [], installed: "all" } },
			})

			expect(stateManager.isFilterActive()).toBe(false)
			expect(stateManager.getState().displayItems).toEqual(mockMarketplaceItems)
			expect(vscode.postMessage).not.toHaveBeenCalled()
		})

		it("reapplies the current installation filter when the catalog refreshes", async () => {
			await stateManager.transition({
				type: "UPDATE_FILTERS",
				payload: { filters: { installed: "installed" } },
			})

			await stateManager.handleMessage({
				type: "marketplaceData",
				marketplaceItems: mockMarketplaceItems,
				marketplaceInstalledMetadata: {
					project: { "test-mcp-2": { type: "mcp" } },
					global: {},
				},
			})

			expect(stateManager.getState().displayItems?.map((item) => item.id)).toEqual(["test-mcp-2"])
		})
	})

	describe("tab switching", () => {
		it("should update active tab", async () => {
			await stateManager.transition({
				type: "SET_ACTIVE_TAB",
				payload: { tab: "mode" },
			})

			const state = stateManager.getState()
			expect(state.activeTab).toBe("mode")
		})

		it("should preserve items when switching tabs", async () => {
			// Load items first
			const message = {
				type: "state",
				state: {
					marketplaceItems: mockMarketplaceItems,
				},
			}
			await stateManager.handleMessage(message)

			// Switch tab
			await stateManager.transition({
				type: "SET_ACTIVE_TAB",
				payload: { tab: "mode" },
			})

			const state = stateManager.getState()
			expect(state.activeTab).toBe("mode")
			expect(state.allItems).toEqual(mockMarketplaceItems)
			expect(state.displayItems).toEqual(mockMarketplaceItems)
		})
	})

	describe("error handling", () => {
		it("should handle empty or invalid messages gracefully", async () => {
			await stateManager.handleMessage(null)
			await stateManager.handleMessage({})
			await stateManager.handleMessage({ type: "invalidType" })

			const state = stateManager.getState()
			expect(state.allItems).toEqual([])
			expect(state.displayItems).toEqual([])
		})

		it("should handle fetch errors", async () => {
			// First load some items
			const message = {
				type: "state",
				state: {
					marketplaceItems: mockMarketplaceItems,
				},
			}
			await stateManager.handleMessage(message)

			// Then trigger an error
			await stateManager.transition({ type: "FETCH_ERROR" })

			const state = stateManager.getState()
			expect(state.isFetching).toBe(false)
			// Items should be preserved during error
			expect(state.allItems).toEqual(mockMarketplaceItems)
		})
	})

	describe("state copying and immutability", () => {
		it("should return new arrays in getState to prevent mutation", () => {
			const state1 = stateManager.getState()
			const state2 = stateManager.getState()

			expect(state1.allItems).not.toBe(state2.allItems)
			expect(state1.displayItems).not.toBe(state2.displayItems)
			expect(state1.filters.tags).not.toBe(state2.filters.tags)
		})

		it("should not mutate original state when modifying returned state", async () => {
			const message = {
				type: "state",
				state: {
					marketplaceItems: mockMarketplaceItems,
				},
			}
			await stateManager.handleMessage(message)

			const state = stateManager.getState()
			state.allItems.push({
				id: "mutated",
				name: "Mutated Item",
				description: "Should not affect original",
				type: "mcp",
				url: "https://example.com/mutated",
				content: "test",
			})

			const newState = stateManager.getState()
			expect(newState.allItems.length).toBe(mockMarketplaceItems.length)
			expect(newState.allItems.find((item) => item.id === "mutated")).toBeUndefined()
		})
	})
})
