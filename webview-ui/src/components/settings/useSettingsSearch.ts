import { useState, useMemo, useCallback } from "react"
import { Fzf } from "fzf"

import type { SectionName } from "./SettingsView"

export interface SearchableSettingData {
	settingId: string
	section: SectionName
	label: string
	sectionLabel: string
}

export interface SearchResult {
	settingId: string
	section: SectionName
	label: string
	sectionLabel: string
	/** Character positions that matched the search query (for highlighting) */
	positions: Set<number>
}

interface UseSettingsSearchOptions {
	getIndex: () => SearchableSettingData[]
}

/**
 * Hook for searching settings using fuzzy matching.
 */
export function useSettingsSearch({ getIndex }: UseSettingsSearchOptions) {
	const [searchQuery, setSearchQuery] = useState("")
	const [isOpen, setIsOpen] = useState(false)

	const hasQuery = searchQuery.trim().length > 0
	const fzf = useMemo(
		() =>
			hasQuery ? new Fzf(getIndex(), { selector: (item) => `${item.label} ${item.sectionLabel}` }) : undefined,
		[getIndex, hasQuery],
	)

	// Search results
	const results = useMemo((): SearchResult[] => {
		if (!fzf) {
			return []
		}

		const fzfResults = fzf.find(searchQuery)
		return fzfResults.slice(0, 10).map((result) => ({
			settingId: result.item.settingId,
			section: result.item.section,
			label: result.item.label,
			sectionLabel: result.item.sectionLabel,
			positions: result.positions,
		}))
	}, [fzf, searchQuery])

	const clearSearch = useCallback(() => {
		setSearchQuery("")
		setIsOpen(false)
	}, [])

	return {
		searchQuery,
		setSearchQuery,
		results,
		isOpen,
		setIsOpen,
		clearSearch,
	}
}
