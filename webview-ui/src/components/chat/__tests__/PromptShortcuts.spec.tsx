import userEvent from "@testing-library/user-event"

import { DEFAULT_PROMPT_SHORTCUTS, type PromptShortcutScope } from "@roo-code/types"

import { act, fireEvent, render, screen, waitFor, within } from "@/utils/test-utils"
import { vscode } from "@/utils/vscode"

import { PromptShortcuts } from "../PromptShortcuts"

vi.mock("@/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

const key = (name: string) => `chat:promptShortcuts.${name}`

async function openEditor(shortcuts = DEFAULT_PROMPT_SHORTCUTS, scope: PromptShortcutScope = "global") {
	const user = userEvent.setup()
	render(
		<PromptShortcuts
			repoPath="/repos/one"
			shortcuts={scope === "global" ? shortcuts : []}
			repoShortcuts={scope === "repository" ? shortcuts : []}
			onInsert={vi.fn()}
		/>,
	)
	await user.click(screen.getByRole("button", { name: key("title") }))
	await user.click(
		screen.getByRole("menuitem", { name: key(scope === "global" ? "manageGlobal" : "manageRepository") }),
	)
	return user
}

function saveResult(requestId: string, success: boolean) {
	act(() =>
		window.dispatchEvent(new MessageEvent("message", { data: { type: "settingsSaveResult", requestId, success } })),
	)
}

describe("PromptShortcuts", () => {
	beforeEach(() => vi.clearAllMocks())

	it("inserts a selected prompt", async () => {
		const user = userEvent.setup()
		const onInsert = vi.fn()
		render(<PromptShortcuts repoPath="/repos/one" shortcuts={DEFAULT_PROMPT_SHORTCUTS} onInsert={onInsert} />)
		await user.click(screen.getByRole("button", { name: key("title") }))
		await user.click(screen.getByRole("menuitem", { name: /Install iOS/ }))
		await waitFor(() => expect(onInsert).toHaveBeenCalledWith(DEFAULT_PROMPT_SHORTCUTS[0].text))
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("shows an empty list when all prompts were removed", async () => {
		const user = userEvent.setup()
		render(<PromptShortcuts repoPath="/repos/one" shortcuts={[]} onInsert={vi.fn()} />)
		await user.click(screen.getByRole("button", { name: key("title") }))
		expect(screen.getByText(key("empty"))).toBeVisible()
		expect(screen.queryByText("Install iOS")).not.toBeInTheDocument()
	})

	it("allows only the global editor without a repository", async () => {
		const user = userEvent.setup()
		render(<PromptShortcuts shortcuts={DEFAULT_PROMPT_SHORTCUTS} onInsert={vi.fn()} />)
		await user.click(screen.getByRole("button", { name: key("title") }))
		expect(screen.getByRole("menuitem", { name: key("manageRepository") })).toHaveAttribute("aria-disabled", "true")
		await user.click(screen.getByRole("menuitem", { name: key("manageGlobal") }))
		expect(screen.getByRole("dialog")).toBeVisible()
	})

	it("buffers edits and discards them on Cancel", async () => {
		const user = await openEditor()
		fireEvent.change(screen.getAllByLabelText(key("name"))[0], { target: { value: "Changed" } })
		expect(vscode.postMessage).not.toHaveBeenCalled()
		await user.click(screen.getByRole("button", { name: key("cancel") }))
		await user.click(screen.getByRole("button", { name: key("title") }))
		await user.click(screen.getByRole("menuitem", { name: key("manageGlobal") }))
		expect(screen.getAllByLabelText(key("name"))[0]).toHaveValue("Install iOS")
		expect(DEFAULT_PROMPT_SHORTCUTS[0].name).toBe("Install iOS")
	})

	it("adds and validates a prompt, then waits for the matching save result", async () => {
		const user = await openEditor([])
		await user.click(screen.getByRole("button", { name: key("add") }))
		const save = screen.getByRole("button", { name: key("save") })
		expect(save).toBeDisabled()
		fireEvent.change(screen.getByLabelText(key("name")), { target: { value: "  Build  " } })
		fireEvent.change(screen.getByLabelText(key("text")), { target: { value: "  " } })
		expect(save).toBeDisabled()
		fireEvent.change(screen.getByLabelText(key("text")), { target: { value: "Build the app" } })
		await user.click(save)
		const message = vi.mocked(vscode.postMessage).mock.calls.at(-1)?.[0]
		expect(message).toMatchObject({
			type: "savePromptShortcuts",
			promptShortcutScope: "global",
			promptShortcuts: [{ id: expect.any(String), name: "Build", text: "Build the app" }],
		})
		expect(message?.requestId).toEqual(expect.any(String))
		expect(screen.getByRole("button", { name: key("saving") })).toBeDisabled()
		saveResult("another-request", true)
		expect(screen.getByRole("dialog")).toBeVisible()
		saveResult(message?.requestId ?? "", false)
		expect(screen.getByRole("alert")).toHaveTextContent(key("saveError"))
		expect(screen.getByLabelText(key("text"))).toHaveValue("Build the app")
		await user.click(screen.getByRole("button", { name: key("save") }))
		const retry = vi.mocked(vscode.postMessage).mock.calls.at(-1)?.[0]
		saveResult(retry?.requestId ?? "", true)
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})

	it("edits and deletes saved prompts, including saving an empty list", async () => {
		const user = await openEditor()
		fireEvent.change(screen.getAllByLabelText(key("text"))[0], { target: { value: "Install on this Mac" } })
		await user.click(screen.getByRole("button", { name: key("save") }))
		const edited = vi.mocked(vscode.postMessage).mock.calls.at(-1)?.[0]
		expect(edited?.promptShortcuts).toEqual([
			{ ...DEFAULT_PROMPT_SHORTCUTS[0], text: "Install on this Mac" },
			DEFAULT_PROMPT_SHORTCUTS[1],
		])
		saveResult(edited?.requestId ?? "", false)
		for (const group of screen.getAllByRole("group")) {
			await user.click(within(group).getByRole("button", { name: key("delete") }))
		}
		await user.click(screen.getByRole("button", { name: key("save") }))
		expect(vi.mocked(vscode.postMessage).mock.calls.at(-1)?.[0].promptShortcuts).toEqual([])
	})

	it("saves only the repository list when the repository editor is selected", async () => {
		const local = [{ id: "local", name: "Local build", text: "Build this repository" }]
		const user = await openEditor(local, "repository")
		await user.click(screen.getByRole("button", { name: key("save") }))
		expect(vi.mocked(vscode.postMessage).mock.calls.at(-1)?.[0]).toMatchObject({
			type: "savePromptShortcuts",
			promptShortcutScope: "repository",
			cwd: "/repos/one",
			promptShortcuts: local,
		})
	})

	it("shows both prompt groups and inserts the selected repository prompt", async () => {
		const user = userEvent.setup()
		const onInsert = vi.fn()
		render(
			<PromptShortcuts
				repoPath="/repos/one"
				shortcuts={DEFAULT_PROMPT_SHORTCUTS}
				repoShortcuts={[{ id: "local", name: "Local build", text: "Build one" }]}
				onInsert={onInsert}
			/>,
		)
		await user.click(screen.getByRole("button", { name: key("title") }))
		expect(screen.getByText(key("global"))).toBeVisible()
		expect(screen.getByText(key("repository"))).toBeVisible()
		expect(screen.getByRole("menuitem", { name: /Install iOS/ })).toBeVisible()
		await user.click(screen.getByRole("menuitem", { name: /Local build/ }))
		await waitFor(() => expect(onInsert).toHaveBeenCalledWith("Build one"))
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("keeps edits available when the save result does not arrive", async () => {
		await openEditor()
		vi.useFakeTimers()
		try {
			fireEvent.click(screen.getByRole("button", { name: key("save") }))
			act(() => vi.advanceTimersByTime(15000))
			expect(screen.getByRole("alert")).toHaveTextContent(key("saveError"))
			expect(screen.getAllByLabelText(key("text"))[0]).toHaveValue(DEFAULT_PROMPT_SHORTCUTS[0].text)
			expect(screen.getByRole("button", { name: key("save") })).toBeEnabled()
		} finally {
			vi.useRealTimers()
		}
	})
})
