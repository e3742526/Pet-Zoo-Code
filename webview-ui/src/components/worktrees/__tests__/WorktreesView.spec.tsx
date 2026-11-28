// npx vitest run src/components/worktrees/__tests__/WorktreesView.spec.tsx

import { fireEvent, screen } from "@testing-library/react"

import { renderWithExtensionState } from "@/utils/test-utils"
import { vscode } from "@src/utils/vscode"

import { WorktreesView } from "../WorktreesView"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

const postMessage = vi.mocked(vscode.postMessage)

const homeScreenSaves = () =>
	postMessage.mock.calls
		.map(([message]) => message as { type: string; updatedSettings?: { showWorktreesInHomeScreen?: boolean } })
		.filter((message) => message.type === "updateSettings")
		.map((message) => message.updatedSettings?.showWorktreesInHomeScreen)

describe("WorktreesView – show in home screen toggle", () => {
	beforeEach(() => postMessage.mockClear())

	it.each([
		["the switch", () => screen.getByTestId("show-worktrees-in-home-screen-toggle")],
		["the label text", () => screen.getByText("worktrees:showInHomeScreen")],
	])("saves the new value once for a click on %s", (_label, target) => {
		renderWithExtensionState(<WorktreesView />, { state: { showWorktreesInHomeScreen: true } })

		fireEvent.click(target())

		expect(homeScreenSaves()).toEqual([false])
	})
})
