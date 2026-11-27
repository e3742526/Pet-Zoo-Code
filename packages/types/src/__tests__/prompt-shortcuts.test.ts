import {
	DEFAULT_PROMPT_SHORTCUTS,
	GLOBAL_SETTINGS_KEYS,
	globalSettingsSchema,
	rooCodeSettingsSchema,
} from "../global-settings.js"

describe("prompt shortcuts", () => {
	it.each([globalSettingsSchema, rooCodeSettingsSchema])(
		"round-trips saved, empty, and unset lists through settings",
		(schema) => {
			for (const promptShortcuts of [DEFAULT_PROMPT_SHORTCUTS, [], undefined]) {
				const settings = schema.parse({ promptShortcuts })
				expect(schema.parse(JSON.parse(JSON.stringify(settings))).promptShortcuts).toEqual(promptShortcuts)
			}
			expect(GLOBAL_SETTINGS_KEYS).toContain("promptShortcuts")
		},
	)

	it.each(
		[
			null,
			"not a list",
			[{ id: "", name: "Name", text: "Text" }],
			[{ id: "id", name: " ", text: "Text" }],
			[{ id: "id", name: "a".repeat(81), text: "Text" }],
			[{ id: "id", name: "Name", text: " \n " }],
			[{ id: "id", name: "Name", text: 4 }],
			[DEFAULT_PROMPT_SHORTCUTS[0], DEFAULT_PROMPT_SHORTCUTS[0]],
		].map((promptShortcuts) => ({ promptShortcuts })),
	)("rejects malformed shortcuts: %j", ({ promptShortcuts }) => {
		expect(globalSettingsSchema.safeParse({ promptShortcuts }).success).toBe(false)
		expect(rooCodeSettingsSchema.safeParse({ promptShortcuts }).success).toBe(false)
	})
})
