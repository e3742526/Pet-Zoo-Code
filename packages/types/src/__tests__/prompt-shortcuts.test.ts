import { DEFAULT_PROMPT_SHORTCUTS, promptShortcutsSchema, promptShortcutScopeSchema } from "../prompt-shortcuts.js"
import { GLOBAL_SETTINGS_KEYS, globalSettingsSchema, rooCodeSettingsSchema } from "../global-settings.js"

describe("prompt shortcuts", () => {
	it.each([DEFAULT_PROMPT_SHORTCUTS, []].map((shortcuts) => ({ shortcuts })))(
		"round-trips repository prompts: %j",
		({ shortcuts }) => {
			expect(promptShortcutsSchema.parse(JSON.parse(JSON.stringify(shortcuts)))).toEqual(shortcuts)
		},
	)

	it.each([globalSettingsSchema, rooCodeSettingsSchema])("round-trips global prompts through settings", (schema) => {
		for (const promptShortcuts of [DEFAULT_PROMPT_SHORTCUTS, [], undefined]) {
			const settings = schema.parse({ promptShortcuts })
			expect(schema.parse(JSON.parse(JSON.stringify(settings))).promptShortcuts).toEqual(promptShortcuts)
		}
		expect(GLOBAL_SETTINGS_KEYS).toContain("promptShortcuts")
		expect(schema.parse({ repoPromptShortcuts: DEFAULT_PROMPT_SHORTCUTS })).not.toHaveProperty(
			"repoPromptShortcuts",
		)
	})

	it.each(["global", "repository"])("accepts the %s scope", (scope) => {
		expect(promptShortcutScopeSchema.parse(scope)).toBe(scope)
	})
	it.each([undefined, "workspace", "", 42])("rejects an invalid scope: %j", (scope) => {
		expect(promptShortcutScopeSchema.safeParse(scope).success).toBe(false)
	})

	it.each(
		[
			null,
			undefined,
			"not a list",
			[{ id: "", name: "Name", text: "Text" }],
			[{ id: "id", name: " ", text: "Text" }],
			[{ id: "id", name: "a".repeat(81), text: "Text" }],
			[{ id: "id", name: "Name", text: " \n " }],
			[{ id: "id", name: "Name", text: 4 }],
			[DEFAULT_PROMPT_SHORTCUTS[0], DEFAULT_PROMPT_SHORTCUTS[0]],
		].map((promptShortcuts) => ({ promptShortcuts })),
	)("rejects malformed shortcuts: %j", ({ promptShortcuts }) => {
		expect(promptShortcutsSchema.safeParse(promptShortcuts).success).toBe(false)
	})
})
