import { fireEvent, screen, waitFor } from "@testing-library/react"
import { QueryClient } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ExtensionState } from "@roo-code/types"

import { renderWithExtensionState } from "@/utils/test-utils"
import { vscode } from "@src/utils/vscode"

import SettingsView from "../SettingsView"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

// The tab's own control is covered by PromptsSettings.enhanceConfig.spec; this stub drives the setter
// SettingsView passes down so the test can follow the cachedState-to-Save path.
vi.mock("../PromptsSettings", () => ({
	default: (props: { enhancementApiConfigId?: string; setEnhancementApiConfigId?: (value: string) => void }) => (
		<div>
			<span data-testid="stub-profile">{props.enhancementApiConfigId ?? ""}</span>
			<button data-testid="stub-pick-light" onClick={() => props.setEnhancementApiConfigId?.("light")} />
			<button data-testid="stub-clear-profile" onClick={() => props.setEnhancementApiConfigId?.("")} />
		</div>
	),
}))

const postMessage = vi.mocked(vscode.postMessage)

type SavedSettings = Partial<Pick<ExtensionState, "enhancementApiConfigId">>

const savedSettings = (): SavedSettings[] =>
	postMessage.mock.calls
		.map((call) => call[0] as { type: string; updatedSettings?: SavedSettings })
		.filter((message) => message.type === "updateSettings")
		.map((message) => message.updatedSettings ?? {})

const renderPrompts = (state: Partial<ExtensionState>) =>
	renderWithExtensionState(<SettingsView onDone={vi.fn()} targetSection="prompts" />, {
		state,
		queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	})

const save = async () => {
	await waitFor(() => expect(screen.getByTestId("save-button")).toBeEnabled())
	fireEvent.click(screen.getByTestId("save-button"))
}

describe("SettingsView – saving the enhancement profile", () => {
	beforeEach(() => postMessage.mockClear())

	it("buffers the edit and sends it only when Save is clicked", async () => {
		renderPrompts({ enhancementApiConfigId: "" })

		fireEvent.click(await screen.findByTestId("stub-pick-light"))

		expect(screen.getByTestId("stub-profile")).toHaveTextContent("light")
		expect(savedSettings()).toEqual([])
		expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "enhancementApiConfigId" }))

		await save()

		expect(savedSettings()).toHaveLength(1)
		expect(savedSettings()[0]).toMatchObject({ enhancementApiConfigId: "light" })
	})

	it("sends an empty profile id when the selected profile is cleared", async () => {
		renderPrompts({ enhancementApiConfigId: "light" })

		fireEvent.click(await screen.findByTestId("stub-clear-profile"))
		await save()

		expect(savedSettings()[0]).toMatchObject({ enhancementApiConfigId: "" })
	})
})
