import { z } from "zod"

export const promptShortcutScopeSchema = z.enum(["global", "repository"])
export type PromptShortcutScope = z.infer<typeof promptShortcutScopeSchema>

export const promptShortcutSchema = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(80),
	text: z.string().refine((text) => text.trim().length > 0),
})

export type PromptShortcut = z.infer<typeof promptShortcutSchema>

export const promptShortcutsSchema = z
	.array(promptShortcutSchema)
	.refine((shortcuts) => new Set(shortcuts.map(({ id }) => id)).size === shortcuts.length)

export const DEFAULT_PROMPT_SHORTCUTS: PromptShortcut[] = [
	{ id: "install-ios", name: "Install iOS", text: "install latest build onto MacOS" },
	{ id: "playtest", name: "Playtest", text: "use agent-skills to run playtest scenarios" },
]
