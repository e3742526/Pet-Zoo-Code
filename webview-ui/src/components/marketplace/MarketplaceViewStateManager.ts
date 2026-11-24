import type { ExtensionMessage, MarketplaceItem, MarketplaceInstalledMetadata } from "@roo-code/types"

export interface ViewState {
	readonly allItems: readonly MarketplaceItem[]
	readonly organizationMcps: readonly MarketplaceItem[]
	readonly displayItems: readonly MarketplaceItem[]
	readonly displayOrganizationMcps: readonly MarketplaceItem[]
	readonly isFetching: boolean
	readonly activeTab: "mcp" | "mode"
	readonly filters: {
		readonly type: string
		readonly search: string
		readonly tags: readonly string[]
		readonly installed: "all" | "installed" | "not_installed"
	}
	readonly installedMetadata?: MarketplaceInstalledMetadata
}

export type ViewStateTransition =
	| { type: "FETCH_ERROR" }
	| { type: "FETCH_COMPLETE"; payload: { items: readonly MarketplaceItem[] } }
	| { type: "SET_ACTIVE_TAB"; payload: { tab: ViewState["activeTab"] } }
	| { type: "UPDATE_FILTERS"; payload: { filters: Partial<ViewState["filters"]> } }

export type StateChangeHandler = (state: ViewState) => void

function defaultState(): ViewState {
	return {
		allItems: [],
		organizationMcps: [],
		displayItems: [],
		displayOrganizationMcps: [],
		isFetching: true,
		activeTab: "mcp",
		filters: { type: "", search: "", tags: [], installed: "all" },
	}
}

function hasActiveFilters({ type, search, tags, installed }: ViewState["filters"]): boolean {
	return !!(type || search || tags.length || installed !== "all")
}

function filterItems(
	items: readonly MarketplaceItem[],
	{ filters, installedMetadata }: ViewState,
): readonly MarketplaceItem[] {
	const { type, search, tags, installed } = filters
	const searchLower = search.toLowerCase()

	return items.filter((item) => {
		if (type && item.type !== type) {
			return false
		}

		if (
			searchLower &&
			!item.name.toLowerCase().includes(searchLower) &&
			!item.description?.toLowerCase().includes(searchLower)
		) {
			return false
		}

		if (tags.length && !item.tags?.some((tag) => tags.includes(tag))) {
			return false
		}

		if (installed !== "all" && installedMetadata) {
			const isInstalled = !!(installedMetadata.global?.[item.id] || installedMetadata.project?.[item.id])
			return installed === "installed" ? isInstalled : !isInstalled
		}

		return true
	})
}

function withFilteredItems(state: ViewState): ViewState {
	const active = hasActiveFilters(state.filters)
	return {
		...state,
		displayItems: active ? filterItems(state.allItems, state) : state.allItems,
		displayOrganizationMcps: active ? filterItems(state.organizationMcps, state) : state.organizationMcps,
	}
}

export class MarketplaceViewStateManager {
	private state: ViewState = defaultState()
	private readonly stateChangeHandlers = new Set<StateChangeHandler>()

	// React reads the same snapshot until a transition publishes a new one.
	public getState = (): ViewState => this.state

	public onStateChange = (handler: StateChangeHandler): (() => void) => {
		this.stateChangeHandlers.add(handler)
		return () => this.stateChangeHandlers.delete(handler)
	}

	private setState(state: ViewState): void {
		this.state = state
		this.stateChangeHandlers.forEach((handler) => handler(state))
	}

	public transition(transition: ViewStateTransition): void {
		switch (transition.type) {
			case "FETCH_COMPLETE":
				this.setCatalog(transition.payload.items)
				break
			case "FETCH_ERROR": {
				const { filters, activeTab, allItems, displayItems } = this.state
				this.setState({ ...defaultState(), filters, activeTab, allItems, displayItems, isFetching: false })
				break
			}
			case "SET_ACTIVE_TAB":
				if (this.state.activeTab !== transition.payload.tab) {
					this.setState({ ...this.state, activeTab: transition.payload.tab })
				}
				break
			case "UPDATE_FILTERS": {
				const previous = this.state.filters
				const {
					type = previous.type,
					search = previous.search,
					tags,
					installed = previous.installed,
				} = transition.payload.filters
				const sameTags =
					!tags || (tags.length === previous.tags.length && tags.every((tag, i) => tag === previous.tags[i]))
				if (
					type === previous.type &&
					search === previous.search &&
					installed === previous.installed &&
					sameTags
				) {
					break
				}
				const nextTags = tags && !sameTags ? [...tags] : previous.tags
				this.setState(
					withFilteredItems({ ...this.state, filters: { type, search, tags: nextTags, installed } }),
				)
				break
			}
		}
	}

	public isFilterActive(): boolean {
		return hasActiveFilters(this.state.filters)
	}

	private setCatalog(
		items?: readonly MarketplaceItem[],
		organizationMcps?: readonly MarketplaceItem[],
		installedMetadata?: MarketplaceInstalledMetadata,
	): void {
		if (!items && !organizationMcps && !installedMetadata) {
			return
		}

		this.setState(
			withFilteredItems({
				...this.state,
				allItems: items ? [...items] : this.state.allItems,
				organizationMcps: organizationMcps ? [...organizationMcps] : this.state.organizationMcps,
				installedMetadata: installedMetadata ?? this.state.installedMetadata,
				isFetching: items === undefined && this.state.isFetching,
			}),
		)
	}

	public handleMessage(message: Partial<ExtensionMessage> | null): void {
		if (!message?.type) {
			this.setState(defaultState())
			return
		}

		switch (message.type) {
			case "state":
				if (!message.state) {
					this.setState(defaultState())
					break
				}
				this.setCatalog(message.state.marketplaceItems, undefined, message.state.marketplaceInstalledMetadata)
				break
			case "marketplaceData":
				this.setCatalog(
					message.marketplaceItems,
					message.marketplaceItems ? (message.organizationMcps ?? []) : message.organizationMcps,
					message.marketplaceInstalledMetadata,
				)
				break
		}
	}
}
