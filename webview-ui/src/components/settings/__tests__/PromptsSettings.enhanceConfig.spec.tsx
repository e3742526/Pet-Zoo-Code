// npx vitest src/components/settings/__tests__/PromptsSettings.enhanceConfig.spec.tsx

import React from "react"

import { render, screen, fireEvent } from "@/utils/test-utils"

import PromptsSettings from "../PromptsSettings"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		listApiConfigMeta: [
			{ id: "cheap", name: "Cheap" },
			{ id: "big", name: "Big" },
		],
		enhancementApiConfigId: "",
		setEnhancementApiConfigId: vi.fn(),
		includeTaskHistoryInEnhance: true,
		setIncludeTaskHistoryInEnhance: vi.fn(),
	}),
}))

// Radix Select needs pointer APIs jsdom lacks; a native select keeps the value/change contract.
vi.mock("@src/components/ui", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	const Select = ({
		value,
		onValueChange,
		children,
	}: {
		value: string
		onValueChange: (value: string) => void
		children: React.ReactNode
	}) => (
		<select value={value} onChange={(e) => onValueChange(e.target.value)}>
			{children}
		</select>
	)
	const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>
	return {
		...actual,
		Select,
		SelectTrigger: () => null,
		SelectValue: () => null,
		SelectContent: Passthrough,
		SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
			<option value={value}>{children}</option>
		),
	}
})

const renderEnhanceTab = (enhancementApiConfigId?: string) => {
	const setEnhancementApiConfigId = vi.fn()
	render(
		<PromptsSettings
			customSupportPrompts={{}}
			setCustomSupportPrompts={vi.fn()}
			enhancementApiConfigId={enhancementApiConfigId}
			setEnhancementApiConfigId={setEnhancementApiConfigId}
		/>,
	)
	// The ENHANCE tab is shown first. Its profile select follows the tab select.
	const profileSelect = screen.getAllByRole("combobox")[1] as HTMLSelectElement
	return { setEnhancementApiConfigId, profileSelect }
}

describe("PromptsSettings - enhancement profile", () => {
	beforeEach(() => vi.mocked(vscode.postMessage).mockClear())

	it("shows the buffered profile from props", () => {
		const { profileSelect } = renderEnhanceTab("big")

		expect(profileSelect.value).toBe("big")
	})

	it.each([
		["a profile", "big", "big"],
		["the current-profile option", "-", ""],
	])("buffers %s without posting a message", (_label, picked, expected) => {
		const { setEnhancementApiConfigId, profileSelect } = renderEnhanceTab("cheap")

		fireEvent.change(profileSelect, { target: { value: picked } })

		expect(setEnhancementApiConfigId).toHaveBeenCalledTimes(1)
		expect(setEnhancementApiConfigId).toHaveBeenCalledWith(expected)
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})
})
