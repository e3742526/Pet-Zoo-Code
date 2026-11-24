import { render, screen, waitFor } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"

import { MarketplaceItem } from "@roo-code/types"

import { vscode } from "@/utils/vscode"
import { TooltipProvider } from "@/components/ui/tooltip"

import { MarketplaceItemCard } from "../MarketplaceItemCard"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, params?: { author?: string; tag?: string; count?: number }) => {
			if (key === "marketplace:items.card.by") {
				return `by ${params?.author}`
			}
			if (key === "marketplace:filters.tags.removeFromFilter") {
				return `Remove ${params?.tag} from filters`
			}
			const translations: Record<string, string> = {
				"marketplace:filters.type.mode": "Mode",
				"marketplace:filters.type.mcpServer": "MCP Server",
				"marketplace:filters.tags.clickToFilter": "Add filter",
				"marketplace:items.components": "Components", // This should be a string for the title prop
				"marketplace:items.card.install": "Install",
				"marketplace:items.card.installed": "Installed",
				"marketplace:items.card.installProject": "Install Project",
				"marketplace:items.card.removeProject": "Remove Project",
				"marketplace:items.card.remove": "Remove",
				"marketplace:items.card.removeProjectTooltip": "Remove from current project",
				"marketplace:items.card.removeGlobalTooltip": "Remove from global configuration",
				"marketplace:items.card.noWorkspaceTooltip": "Open a workspace to install marketplace items",
				"marketplace:items.matched": "matched",
			}
			// Special handling for "marketplace:items.components" when it's used as a badge with count
			if (key === "marketplace:items.components" && params?.count !== undefined) {
				return `${params.count} Components`
			}
			// Special handling for "marketplace:items.matched" when it's used as a badge with count
			if (key === "marketplace:items.matched" && params?.count !== undefined) {
				return `${params.count} matched`
			}
			return translations[key] || key
		},
	}),
}))

const renderWithProviders = (ui: React.ReactElement) => {
	return render(<TooltipProvider delayDuration={300}>{ui}</TooltipProvider>)
}

describe("MarketplaceItemCard", () => {
	const defaultItem: MarketplaceItem = {
		id: "test-item",
		name: "Test Item",
		description: "Test Description",
		type: "mode",
		author: "Test Author",
		authorUrl: "https://example.com",
		tags: ["test", "example"],
		content: "test content",
	}

	const defaultProps = {
		item: defaultItem,
		selectedTags: [] as string[],
		setFilters: vi.fn(),
		hasWorkspace: true,
		isInstalledInProject: false,
		isInstalledGlobally: false,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders basic item information", () => {
		renderWithProviders(<MarketplaceItemCard {...defaultProps} />)

		expect(screen.getByText("Test Item")).toBeInTheDocument()
		expect(screen.getByText("Test Description")).toBeInTheDocument()
		expect(screen.getByText("by Test Author")).toBeInTheDocument()
	})

	it("renders install button", () => {
		renderWithProviders(<MarketplaceItemCard {...defaultProps} />)

		// Should show install button
		expect(screen.getByText("Install")).toBeInTheDocument()
	})

	it("renders tags and handles tag clicks", async () => {
		const user = userEvent.setup()
		const setFilters = vi.fn()

		renderWithProviders(<MarketplaceItemCard {...defaultProps} setFilters={setFilters} />)

		const tagButton = screen.getByText("test")
		await user.click(tagButton)

		expect(setFilters).toHaveBeenCalledWith({ tags: ["test"] })
	})

	it.each([
		{ selectedTags: [], tooltip: "Add filter" },
		{ selectedTags: ["test"], tooltip: "Remove test from filters" },
	])("shows '$tooltip' on hover when selected tags are $selectedTags", async ({ selectedTags, tooltip }) => {
		const user = userEvent.setup()
		renderWithProviders(<MarketplaceItemCard {...defaultProps} selectedTags={selectedTags} />)

		await user.hover(screen.getByText("test"))

		await waitFor(() => expect(screen.getByRole("tooltip", { name: tooltip })).toBeInTheDocument(), {
			timeout: 1000,
		})
	})

	it("handles author link click", async () => {
		const user = userEvent.setup()
		renderWithProviders(<MarketplaceItemCard {...defaultProps} />)

		const authorLink = screen.getByText("by Test Author")
		await user.click(authorLink)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: "https://example.com",
		})
	})

	it("does not render invalid author URLs", () => {
		const itemWithInvalidUrl: MarketplaceItem = {
			...defaultItem,
			authorUrl: "invalid-url",
		}

		renderWithProviders(<MarketplaceItemCard {...defaultProps} item={itemWithInvalidUrl} />)

		const authorText = screen.getByText(/by Test Author/) // Changed to regex
		expect(authorText.tagName).not.toBe("BUTTON")
	})

	it("shows the install button when no workspace is open", () => {
		renderWithProviders(<MarketplaceItemCard {...defaultProps} hasWorkspace={false} />)

		expect(screen.getByText("Install")).toBeInTheDocument()
	})

	it("shows single Installed badge when item is installed", () => {
		const installedProps = {
			...defaultProps,
			isInstalledInProject: true,
		}

		renderWithProviders(<MarketplaceItemCard {...installedProps} />)

		// Should show single "Installed" badge
		expect(screen.getByText("Installed")).toBeInTheDocument()
		// Should show Remove button instead of Install
		expect(screen.getByText("Remove")).toBeInTheDocument()
		// Should not show Install button
		expect(screen.queryByText("Install")).not.toBeInTheDocument()
	})

	it("shows single Installed badge even when installed in both locations", () => {
		const installedProps = {
			...defaultProps,
			isInstalledInProject: true,
			isInstalledGlobally: true,
		}

		renderWithProviders(<MarketplaceItemCard {...installedProps} />)

		// Should show only one "Installed" badge
		const installedBadges = screen.getAllByText("Installed")
		expect(installedBadges).toHaveLength(1)
		// Should show Remove button
		expect(screen.getByText("Remove")).toBeInTheDocument()
	})
})
