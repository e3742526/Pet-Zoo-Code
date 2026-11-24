import type { HTMLAttributes } from "react"

import type { SearchableSettingId } from "./settingsSearchIndex"

interface SearchableSettingProps extends HTMLAttributes<HTMLDivElement> {
	settingId: SearchableSettingId
}

/** Marks the control that Settings search should scroll to. */
export function SearchableSetting({ settingId, ...props }: SearchableSettingProps) {
	return <div data-setting-id={settingId} {...props} />
}
