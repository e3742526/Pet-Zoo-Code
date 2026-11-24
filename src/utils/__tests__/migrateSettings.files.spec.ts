import * as fs from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import * as vscode from "vscode"
import { parse } from "yaml"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { makeExtensionContext, makeUri, makeWorkspaceConfiguration } from "../../test-utils/vscode"
import { migrateSettings } from "../migrateSettings"

vi.mock("fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("fs/promises")>()
	const monitored = { access: vi.fn(fs.access), readdir: vi.fn(fs.readdir), rename: vi.fn(fs.rename) }
	return { ...fs, ...monitored, default: { ...fs, ...monitored } }
})

const legacyModes = { customModes: [{ slug: "legacy-mode", name: "Legacy Mode" }] }
const legacyMcp = { mcpServers: {} }
const legacyFiles = ["cline_custom_modes.json", "cline_mcp_settings.json"] as const
const originalModes = "custom_modes.json"

let root: string
let settingsDir: string
let context: vscode.ExtensionContext
// The migration only calls appendLine on the output channel.
const outputChannel = { appendLine: vi.fn<(value: string) => void>() } as unknown as vscode.OutputChannel

beforeEach(async () => {
	root = await fs.mkdtemp(join(tmpdir(), "zoo-settings-migration-"))
	settingsDir = join(root, "settings")
	context = makeExtensionContext({ globalStorageUri: makeUri(root) })
	vi.mocked(context.globalState.get).mockReturnValue(true)
	vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(makeWorkspaceConfiguration({}))
	vi.clearAllMocks()
})

afterEach(async () => {
	vi.restoreAllMocks()
	await fs.rm(root, { recursive: true, force: true })
})

async function writeLegacyFiles(directory: string) {
	await fs.mkdir(directory, { recursive: true })
	await Promise.all([
		fs.writeFile(join(directory, legacyFiles[0]), JSON.stringify(legacyModes)),
		fs.writeFile(join(directory, legacyFiles[1]), JSON.stringify(legacyMcp)),
	])
}

async function expectMigratedFiles(directory: string) {
	expect(await fs.readFile(join(directory, originalModes), "utf8")).toBe(JSON.stringify(legacyModes))
	expect(parse(await fs.readFile(join(directory, GlobalFileNames.customModes), "utf8"))).toEqual(legacyModes)
	expect(JSON.parse(await fs.readFile(join(directory, GlobalFileNames.mcpSettings), "utf8"))).toEqual(legacyMcp)
	const names = await fs.readdir(directory)
	for (const oldFile of legacyFiles) expect(names).not.toContain(oldFile)
}

it("uses one scan on a clean launch and migrates legacy files added later", async () => {
	await migrateSettings(context, outputChannel)
	expect(fs.readdir).toHaveBeenCalledExactlyOnceWith(settingsDir)
	expect(fs.access).not.toHaveBeenCalled()

	await writeLegacyFiles(settingsDir)
	await migrateSettings(context, outputChannel)
	await expectMigratedFiles(settingsDir)
})

it("confirms the converted file and keeps the saved YAML and rollback JSON", async () => {
	await fs.mkdir(settingsDir, { recursive: true })
	const savedYaml = "customModes: []\n"
	const savedJson = JSON.stringify(legacyModes)
	await Promise.all([
		fs.writeFile(join(settingsDir, GlobalFileNames.customModes), savedYaml),
		fs.writeFile(join(settingsDir, originalModes), savedJson),
	])

	await migrateSettings(context, outputChannel)
	expect(fs.readdir).toHaveBeenCalledExactlyOnceWith(settingsDir)
	expect(fs.access).toHaveBeenCalledExactlyOnceWith(join(settingsDir, GlobalFileNames.customModes))
	expect(await fs.readFile(join(settingsDir, GlobalFileNames.customModes), "utf8")).toBe(savedYaml)
	expect(await fs.readFile(join(settingsDir, originalModes), "utf8")).toBe(savedJson)
})

it("checks known file paths when listing the settings directory fails", async () => {
	await writeLegacyFiles(settingsDir)
	vi.mocked(fs.readdir).mockRejectedValueOnce(Object.assign(new Error("Cannot list settings"), { code: "EACCES" }))

	await migrateSettings(context, outputChannel)
	expect(fs.access).toHaveBeenCalledWith(join(settingsDir, legacyFiles[0]))
	await expectMigratedFiles(settingsDir)
})

it("retries a failed file migration on the next launch", async () => {
	await writeLegacyFiles(settingsDir)
	vi.mocked(fs.rename).mockRejectedValueOnce(new Error("Settings files are temporarily unavailable"))

	await migrateSettings(context, outputChannel)
	expect(await fs.readFile(join(settingsDir, legacyFiles[0]), "utf8")).toBe(JSON.stringify(legacyModes))

	await migrateSettings(context, outputChannel)
	await expectMigratedFiles(settingsDir)
})

it("finds legacy files after the configured storage path changes", async () => {
	await migrateSettings(context, outputChannel)
	const customStoragePath = join(root, "custom")
	const customSettingsDir = join(customStoragePath, "settings")
	await writeLegacyFiles(customSettingsDir)
	vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(makeWorkspaceConfiguration({ customStoragePath }))

	await migrateSettings(context, outputChannel)
	await expectMigratedFiles(customSettingsDir)
})
