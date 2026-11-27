import { expect, test } from "../../../../playwright/coverage-fixture"
import { expectBoundedLayout } from "../../../../playwright/layout-contracts"
import { mountedStory } from "../../../../playwright/mounted-story"
import { applyVisualTheme, visualThemes } from "../../../../playwright/themes"

for (const theme of visualThemes) {
	test(`renders the production chat composer in the VS Code ${theme.name} theme`, async ({ mount, page }) => {
		const component = mountedStory(await mount("chat-text-area"))
		await applyVisualTheme(page, theme)
		// The full provider bundle leaves a bare Zod reference after gallery tree-shaking.
		await page.evaluate(() => Object.assign(globalThis, { z: undefined }))
		const story = component.getByTestId("chat-text-area-story")
		const editor = story.getByRole("textbox")
		await expect(editor).toBeVisible()
		await expect(story).toHaveScreenshot(`chat-composer-resting-${theme.name}.png`)

		await editor.focus()
		await expect(editor).toBeFocused()
		await expect(story).toHaveScreenshot(`chat-composer-focus-${theme.name}.png`)
		await expectBoundedLayout(page, story, {
			actionRows: [story.getByTestId("composer-toolbar"), story.locator(".flex.items-center.gap-2").last()],
			focusedControl: editor,
		})
	})
}

test("shows saved prompts and their editor above the composer", async ({ mount, page }) => {
	const component = mountedStory(await mount("chat-text-area", { withRepositoryPrompts: true }))
	await page.setViewportSize({ width: 520, height: 700 })
	await applyVisualTheme(page, visualThemes[0])
	await page.evaluate(() => Object.assign(globalThis, { z: undefined }))
	const trigger = component.getByRole("button", { name: "Saved prompts" })
	await trigger.focus()
	await page.keyboard.press("ArrowDown")
	const menu = page.getByRole("menu")
	await expect(menu).toBeVisible()
	await expect(menu).toHaveCSS("background-color", "rgb(49, 49, 49)")
	await expect(page).toHaveScreenshot("chat-prompt-shortcuts.png")
	await page.keyboard.press("Enter")
	const editor = component.getByRole("textbox")
	await expect(editor).toBeFocused()
	await expect(editor).toHaveValue(/Build this repository/)
	await trigger.click()
	await page.getByRole("menuitem", { name: "Manage global prompts" }).click()
	const dialog = page.getByRole("dialog")
	await expect(dialog).toBeVisible()
	await expect(page).toHaveScreenshot("chat-prompt-shortcuts-editor.png")
	await expectBoundedLayout(page, dialog, { focusedControl: dialog.getByRole("textbox").first() })
})

test("shows the repository prompt editor", async ({ mount, page }) => {
	const component = mountedStory(await mount("chat-text-area", { withRepositoryPrompts: true }))
	await page.setViewportSize({ width: 520, height: 700 })
	await applyVisualTheme(page, visualThemes[0])
	await page.evaluate(() => Object.assign(globalThis, { z: undefined }))
	await component.getByRole("button", { name: "Saved prompts" }).click()
	await page.getByRole("menuitem", { name: "Manage repository prompts" }).click()
	const dialog = page.getByRole("dialog")
	await expect(dialog.getByLabel("Name")).toHaveValue("Build repository")
	await expect(page).toHaveScreenshot("chat-prompt-shortcuts-repository-editor.png")
	await expectBoundedLayout(page, dialog, { focusedControl: dialog.getByRole("textbox").first() })
})

test("places the native agent selector below the prompt at 320px", async ({ mount, page }) => {
	await page.setViewportSize({ width: 320, height: 700 })
	const component = mountedStory(await mount("chat-text-area", { withAgentEngine: true }))
	await applyVisualTheme(page, visualThemes[0])
	await page.evaluate(() => Object.assign(globalThis, { z: undefined }))
	const story = component.getByTestId("chat-text-area-story")
	const editor = story.getByRole("textbox")
	const group = story.getByRole("group", { name: "Agent engine" })
	await expect(group.getByRole("radio", { name: "Codex" })).toBeChecked()
	await group.getByRole("radio", { name: "Codex" }).focus()
	await page.keyboard.press("ArrowLeft")
	await expect(group.getByRole("radio", { name: "Dory" })).toBeChecked()
	await page.keyboard.press("ArrowRight")
	await expect(group.getByRole("radio", { name: "Codex" })).toBeChecked()
	await editor.focus()
	const editorBox = await editor.boundingBox()
	const groupBox = await group.boundingBox()
	expect(groupBox!.y).toBeGreaterThan(editorBox!.y)
	await expect(story).toHaveScreenshot("chat-composer-native-engine.png")
	await expectBoundedLayout(page, story, { actionRows: [group], focusedControl: editor })
})
