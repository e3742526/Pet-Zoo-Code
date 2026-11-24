import { expect, test } from "../../../../playwright/coverage-fixture"
import { mountedStory } from "../../../../playwright/mounted-story"

test("renders the open provider dropdown without Zoo Gateway", async ({ mount, page }) => {
	await page.setViewportSize({ width: 520, height: 720 })
	// The full provider bundle leaves bare Zod references after gallery tree-shaking.
	await page.evaluate(() => Object.assign(globalThis, { z: undefined, z$1: undefined }))
	const component = mountedStory(await mount("api-provider-dropdown"))

	await component.getByTestId("provider-select").click()
	const providers = page.getByRole("listbox")
	await expect(providers).toBeVisible()
	await expect(providers.getByRole("option", { name: "Zoo Gateway" })).toHaveCount(0)
	await expect(page).toHaveScreenshot("api-provider-dropdown-open.png")
})
