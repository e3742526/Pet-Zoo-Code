// npx vitest run src/components/marketplace/__tests__/MarketplaceListView.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"

import { TooltipProvider } from "@/components/ui/tooltip"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

import { MarketplaceListView, type MarketplaceListViewProps } from "../MarketplaceListView"
import type { ViewState } from "../MarketplaceViewStateManager"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

const setFilters = vi.fn<MarketplaceListViewProps["setFilters"]>()
const initialState: ViewState = {
	allItems: [],
	organizationMcps: [],
	displayItems: [],
	displayOrganizationMcps: [],
	isFetching: false,
	activeTab: "mcp",
	filters: {
		type: "",
		search: "",
		tags: [],
		installed: "all",
	},
}

describe("MarketplaceListView", () => {
	let state: ViewState
	beforeEach(() => {
		vi.clearAllMocks()
		state = initialState
	})

	const renderWithProviders = () =>
		render(
			<ExtensionStateContextProvider>
				<TooltipProvider delayDuration={300}>
					<MarketplaceListView state={state} setFilters={setFilters} allTags={["tag1", "tag2"]} />
				</TooltipProvider>
			</ExtensionStateContextProvider>,
		)

	it("renders search input", () => {
		renderWithProviders()

		const searchInput = screen.getByPlaceholderText("marketplace:filters.search.placeholder")
		expect(searchInput).toBeInTheDocument()
	})

	it("does not render type filter (removed in simplified interface)", () => {
		renderWithProviders()

		expect(screen.queryByText("marketplace:filters.type.label")).not.toBeInTheDocument()
		expect(screen.queryByText("marketplace:filters.type.all")).not.toBeInTheDocument()
	})

	it("does not render sort options (removed in simplified interface)", () => {
		renderWithProviders()

		expect(screen.queryByText("marketplace:filters.sort.label")).not.toBeInTheDocument()
		expect(screen.queryByText("marketplace:filters.sort.name")).not.toBeInTheDocument()
	})

	it("renders tags section when tags are available", () => {
		renderWithProviders()

		expect(screen.getByText("marketplace:filters.tags.label")).toBeInTheDocument()
	})

	it("shows loading state when fetching", () => {
		state = { ...state, isFetching: true }

		renderWithProviders()

		expect(screen.getByText("marketplace:items.refresh.refreshing")).toBeInTheDocument()
		expect(screen.getByText("marketplace:items.refresh.mayTakeMoment")).toBeInTheDocument()
	})

	it("shows empty state when no items and not fetching", () => {
		renderWithProviders()

		expect(screen.getByText("marketplace:items.empty.noItems")).toBeInTheDocument()
		expect(screen.getByText("marketplace:items.empty.adjustFilters")).toBeInTheDocument()
	})

	it("updates search filter when typing", () => {
		renderWithProviders()

		const searchInput = screen.getByPlaceholderText("marketplace:filters.search.placeholder")
		fireEvent.change(searchInput, { target: { value: "test" } })

		expect(setFilters).toHaveBeenCalledWith({ search: "test" })
	})

	it("shows clear tags button when tags are selected", async () => {
		const user = userEvent.setup()
		state = { ...state, filters: { ...state.filters, tags: ["tag1"] } }

		renderWithProviders()

		const clearButton = screen.getByText("marketplace:filters.tags.clear")
		expect(clearButton).toBeInTheDocument()

		await user.click(clearButton)
		expect(setFilters).toHaveBeenCalledWith({ tags: [] })
	})
})
