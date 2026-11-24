import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { fileExistsAtPath } from "./fs"
import { GlobalFileNames } from "../shared/globalFileNames"
import { getSettingsDirectoryPath } from "./storage"
import * as yaml from "yaml"

const deprecatedCustomModesJSONFilename = "custom_modes.json"
const fileMigrations = [
	{ oldName: "cline_custom_modes.json", newName: deprecatedCustomModesJSONFilename },
	{ oldName: "cline_mcp_settings.json", newName: GlobalFileNames.mcpSettings },
]

/** Migrates legacy settings files and removes commands from old defaults. */
export async function migrateSettings(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	// First, migrate commands from old defaults (security fix)
	await migrateDefaultCommands(context, outputChannel)

	try {
		const settingsDir = await getSettingsDirectoryPath(context.globalStorageUri.fsPath)

		let entries: string[] | undefined
		try {
			entries = await fs.readdir(settingsDir)
		} catch {
			// Some directories allow access to known paths even when listing fails.
			if (!(await fileExistsAtPath(settingsDir))) {
				outputChannel.appendLine("No settings directory found, no migrations necessary")
				return
			}
		}
		// Find possible legacy names on both case-sensitive and case-insensitive filesystems.
		const candidates = entries && new Set(entries.map((entry) => entry.toLowerCase()))

		try {
			for (const migration of fileMigrations) {
				if (candidates?.has(migration.oldName) === false) continue

				const oldPath = path.join(settingsDir, migration.oldName)
				const newPath = path.join(settingsDir, migration.newName)

				// Only migrate if old file exists and new file doesn't exist yet
				// This ensures we don't overwrite any existing new files
				const oldFileExists = await fileExistsAtPath(oldPath)
				if (oldFileExists && !(await fileExistsAtPath(newPath))) {
					await fs.rename(oldPath, newPath)
					candidates?.add(migration.newName)
					outputChannel.appendLine(`Renamed ${migration.oldName} to ${migration.newName}`)
				} else {
					outputChannel.appendLine(
						`Skipping migration of ${migration.oldName} to ${migration.newName}: ${oldFileExists ? "new file already exists" : "old file not found"}`,
					)
				}
			}

			if (candidates?.has(deprecatedCustomModesJSONFilename) === false) return
			if (
				candidates?.has(GlobalFileNames.customModes) &&
				(await fileExistsAtPath(path.join(settingsDir, GlobalFileNames.customModes)))
			) {
				outputChannel.appendLine("custom_modes.yaml already exists, skipping migration")
				return
			}
			await migrateCustomModesToYaml(settingsDir, outputChannel)
		} catch (error) {
			outputChannel.appendLine(`Error in file migrations: ${error}`)
		}
	} catch (error) {
		outputChannel.appendLine(`Error migrating settings files: ${error}`)
	}
}

/**
 * Special migration function to convert custom_modes.json to YAML format
 */
async function migrateCustomModesToYaml(settingsDir: string, outputChannel: vscode.OutputChannel): Promise<void> {
	const oldJsonPath = path.join(settingsDir, deprecatedCustomModesJSONFilename)
	const newYamlPath = path.join(settingsDir, GlobalFileNames.customModes)

	// Only proceed if JSON exists and YAML doesn't
	if (!(await fileExistsAtPath(oldJsonPath))) {
		outputChannel.appendLine("No custom_modes.json found, skipping YAML migration")
		return
	}

	if (await fileExistsAtPath(newYamlPath)) {
		outputChannel.appendLine("custom_modes.yaml already exists, skipping migration")
		return
	}

	try {
		// Read JSON content
		const jsonContent = await fs.readFile(oldJsonPath, "utf-8")

		try {
			// Parse JSON to object (using the yaml library just to be safe/consistent)
			const customModesData = yaml.parse(jsonContent)

			// Convert to YAML with no line width limit to prevent line breaks
			const yamlContent = yaml.stringify(customModesData, { lineWidth: 0 })

			// Write YAML file
			await fs.writeFile(newYamlPath, yamlContent, "utf-8")

			// Keeping the old JSON file for backward compatibility
			// This allows users to roll back if needed
			outputChannel.appendLine(
				"Successfully migrated custom_modes.json to YAML format (original JSON file preserved for rollback purposes)",
			)
		} catch (parseError) {
			// Handle corrupt JSON file
			outputChannel.appendLine(
				`Error parsing custom_modes.json: ${parseError}. File might be corrupted. Skipping migration.`,
			)
		}
	} catch (fileError) {
		outputChannel.appendLine(`Error reading custom_modes.json: ${fileError}. Skipping migration.`)
	}
}

/**
 * Removes commands from old defaults that could execute arbitrary code
 * This addresses the security vulnerability where npm install/test can run malicious postinstall scripts
 */
async function migrateDefaultCommands(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	try {
		// Check if this migration has already been run
		const migrationKey = "defaultCommandsMigrationCompleted"
		if (context.globalState.get(migrationKey)) {
			outputChannel.appendLine("[Default Commands Migration] Migration already completed, skipping")
			return
		}

		const allowedCommands = context.globalState.get<string[]>("allowedCommands")

		if (!allowedCommands || !Array.isArray(allowedCommands)) {
			// Mark migration as complete even if no commands to migrate
			await context.globalState.update(migrationKey, true)
			outputChannel.appendLine("No allowed commands found in global state, marking migration as complete")
			return
		}

		// Only migrate the specific commands that were removed from the defaults
		const oldDefaultCommands = ["npm install", "npm test", "tsc"]

		// Filter out old default commands (case-insensitive exact match only)
		const originalLength = allowedCommands.length
		const filteredCommands = allowedCommands.filter((cmd) => {
			const cmdLower = cmd.toLowerCase().trim()
			return !oldDefaultCommands.some((oldDefault) => cmdLower === oldDefault.toLowerCase())
		})

		if (filteredCommands.length < originalLength) {
			const removedCount = originalLength - filteredCommands.length
			await context.globalState.update("allowedCommands", filteredCommands)

			outputChannel.appendLine(
				`[Default Commands Migration] Removed ${removedCount} command(s) from old defaults to prevent arbitrary code execution vulnerability`,
			)
		} else {
			outputChannel.appendLine("[Default Commands Migration] No old default commands found in allowed list")
		}

		// Mark migration as complete
		await context.globalState.update(migrationKey, true)
		outputChannel.appendLine("[Default Commands Migration] Migration marked as complete")
	} catch (error) {
		outputChannel.appendLine(`[Default Commands Migration] Error migrating default commands: ${error}`)
	}
}
