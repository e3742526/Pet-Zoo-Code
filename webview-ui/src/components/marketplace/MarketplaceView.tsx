import { useState, useEffect, useMemo, useContext, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { Tab, TabContent, TabHeader } from "../common/Tab"
import type { MarketplaceViewStateManager, ViewState } from "./MarketplaceViewStateManager"
import { useStateManager } from "./useStateManager"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { MarketplaceListView } from "./MarketplaceListView"
import { cn } from "@/lib/utils"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"

interface MarketplaceViewProps {
	onDone?: () => void
	stateManager: MarketplaceViewStateManager
	targetTab?: "mcp" | "mode"
}
export function MarketplaceView({ stateManager: manager, onDone, targetTab }: MarketplaceViewProps) {
	const { t } = useAppTranslation()
	const state = useStateManager(manager)
	const extensionState = useContext(ExtensionStateContext)
	const [lastOrganizationSettingsVersion, setLastOrganizationSettingsVersion] = useState<number>(
		extensionState?.organizationSettingsVersion ?? -1,
	)

	useEffect(() => {
		const currentVersion = extensionState?.organizationSettingsVersion ?? -1
		if (currentVersion !== lastOrganizationSettingsVersion) {
			vscode.postMessage({
				type: "fetchMarketplaceData",
			})
		}
		setLastOrganizationSettingsVersion(currentVersion)
	}, [extensionState?.organizationSettingsVersion, lastOrganizationSettingsVersion])

	useEffect(() => {
		if (targetTab && (targetTab === "mcp" || targetTab === "mode")) {
			manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: targetTab } })
		}
	}, [targetTab, manager])

	useEffect(() => {
		if (manager.getState().allItems.length === 0) {
			vscode.postMessage({ type: "fetchMarketplaceData" })
		}
	}, [manager])

	const setFilters = useCallback(
		(filters: Partial<ViewState["filters"]>) =>
			manager.transition({ type: "UPDATE_FILTERS", payload: { filters } }),
		[manager],
	)

	// Memoize all available tags
	const allTags = useMemo(
		() => Array.from(new Set(state.allItems.flatMap((item) => item.tags || []))).sort(),
		[state.allItems],
	)

	return (
		<TooltipProvider delayDuration={300}>
			<Tab>
				<TabHeader className="flex flex-col sticky top-0 z-10 px-3 py-2">
					<div className="flex items-center justify-between gap-2 px-2">
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								className="px-1.5 -ml-2"
								onClick={() => onDone?.()}
								aria-label={t("settings:back")}>
								<ArrowLeft />
								<span className="sr-only">{t("settings:back")}</span>
							</Button>
							<h3 className="font-bold m-0">{t("marketplace:title")}</h3>
						</div>
					</div>

					<div className="w-full mt-2">
						<div className="flex relative py-1">
							<div className="absolute w-full h-[2px] -bottom-[2px] bg-vscode-input-border">
								<div
									className={cn(
										"absolute w-1/2 h-[2px] bottom-0 bg-vscode-button-background transition-all duration-300 ease-in-out",
										{
											"left-0": state.activeTab === "mcp",
											"left-1/2": state.activeTab === "mode",
										},
									)}
								/>
							</div>
							<button
								className="cursor-pointer flex items-center justify-center gap-2 flex-1 text-sm font-medium rounded-sm transition-colors duration-300 relative z-10 text-vscode-foreground"
								onClick={() => manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: "mcp" } })}>
								{t("marketplace:tabs.mcp")}
							</button>
							<button
								className="cursor-pointer flex items-center justify-center gap-2 flex-1 text-sm font-medium rounded-sm transition-colors duration-300 relative z-10 text-vscode-foreground"
								onClick={() =>
									manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: "mode" } })
								}>
								{t("marketplace:tabs.modes")}
							</button>
						</div>
					</div>
				</TabHeader>

				<TabContent className="p-3 pt-2">
					<MarketplaceListView
						key={state.activeTab}
						state={state}
						setFilters={setFilters}
						allTags={allTags}
						filterByType={state.activeTab}
					/>
				</TabContent>
			</Tab>
		</TooltipProvider>
	)
}
