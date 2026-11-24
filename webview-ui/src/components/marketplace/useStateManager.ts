import { useEffect, useSyncExternalStore } from "react"
import type { ExtensionMessage } from "@roo-code/types"
import type { MarketplaceViewStateManager } from "./MarketplaceViewStateManager"

export function useStateManager(manager: MarketplaceViewStateManager) {
	useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => manager.handleMessage(event.data)
		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [manager])

	return useSyncExternalStore(manager.onStateChange, manager.getState)
}
