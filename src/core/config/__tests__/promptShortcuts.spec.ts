import fs from "fs/promises"
import os from "os"
import path from "path"

import { DEFAULT_PROMPT_SHORTCUTS } from "@roo-code/types"

import { loadPromptShortcuts, savePromptShortcuts } from "../promptShortcuts"

describe("repository prompt storage", () => {
	let root: string
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-prompts-"))
	})
	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	it("keeps two repositories separate and reads saved prompts again", async () => {
		const first = path.join(root, "first")
		const second = path.join(root, "second")
		const build = [{ id: "build", name: "  Build  ", text: "Build this repository" }]
		const test = [{ id: "test", name: "Test", text: "Test this repository" }]
		await savePromptShortcuts(first, build)
		expect(await loadPromptShortcuts(second)).toEqual([])
		await savePromptShortcuts(second, test)
		expect(await loadPromptShortcuts(first)).toEqual([{ ...build[0], name: "Build" }])
		expect(await loadPromptShortcuts(second)).toEqual(test)
		expect(JSON.parse(await fs.readFile(path.join(first, ".roo", "prompt-shortcuts.json"), "utf8"))).toEqual([
			{ ...build[0], name: "Build" },
		])
		await savePromptShortcuts(first, [])
		expect(await loadPromptShortcuts(first)).toEqual([])
		expect(await loadPromptShortcuts(second)).toEqual(test)
	})

	it("starts with an empty local list when no repository file exists", async () => {
		const first = await loadPromptShortcuts(root)
		first.push({ id: "build", name: "Changed", text: "Build" })
		expect(await loadPromptShortcuts(root)).toEqual([])
		expect(await loadPromptShortcuts(undefined)).toEqual([])
	})

	it("requires a repository before writing local prompts", async () => {
		await expect(savePromptShortcuts("", [])).rejects.toThrow("Open a repository")
	})

	it("rejects invalid edits without replacing the saved list", async () => {
		await savePromptShortcuts(root, DEFAULT_PROMPT_SHORTCUTS)
		await expect(savePromptShortcuts(root, [{ id: "a", name: " ", text: "Bad" }])).rejects.toThrow()
		expect(await loadPromptShortcuts(root)).toEqual(DEFAULT_PROMPT_SHORTCUTS)
	})

	it.each(["not json", '[{"id":"a","name":" ","text":"Bad"}]'])("reports invalid stored data: %s", async (text) => {
		await fs.mkdir(path.join(root, ".roo"))
		await fs.writeFile(path.join(root, ".roo", "prompt-shortcuts.json"), text)
		await expect(loadPromptShortcuts(root)).rejects.toThrow()
	})
})
