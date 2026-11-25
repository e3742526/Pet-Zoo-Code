import { constants as fsConstants, promises as fs } from "fs"
import * as os from "os"
import * as path from "path"

/**
 * Folders that CLI installers commonly use. VS Code started from the macOS Dock or Finder can have
 * a shorter PATH than a login shell, so these are searched after PATH.
 */
function fallbackSearchDirectories(): string[] {
	const home = os.homedir()
	if (process.platform === "win32") {
		const localAppData = process.env.LOCALAPPDATA
		return [path.join(home, ".local", "bin"), ...(localAppData ? [path.join(localAppData, "Programs")] : [])]
	}
	return [path.join(home, ".local", "bin"), path.join(home, "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
}

export function getCliSearchDirectories(): string[] {
	const pathDirectories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
	return [...new Set([...pathDirectories, ...fallbackSearchDirectories()])]
}

function executableCandidates(name: string): string[] {
	if (process.platform !== "win32" || path.extname(name)) {
		return [name]
	}
	const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
	return [name, ...extensions.map((extension) => name + extension.toLowerCase())]
}

async function isExecutableFile(candidate: string): Promise<boolean> {
	try {
		const stat = await fs.stat(candidate)
		if (!stat.isFile()) return false
		await fs.access(candidate, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK)
		return true
	} catch {
		return false
	}
}

export function expandHomeDirectory(value: string): string {
	if (value === "~") return os.homedir()
	if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2))
	return value
}

/**
 * Finds the CLI executable.
 *
 * A configured path that contains a folder must point at an executable file. A bare name (the
 * default) is looked up in PATH and then in common install folders. The lookup runs for every
 * request, so a newly installed or moved CLI is found without restarting VS Code.
 */
export async function resolveCliExecutable(
	configured: string | undefined,
	defaultName: string,
	label: string,
): Promise<string> {
	const requested = expandHomeDirectory(configured?.trim() || defaultName)

	if (requested.includes("/") || requested.includes("\\")) {
		for (const candidate of executableCandidates(requested)) {
			if (await isExecutableFile(candidate)) {
				return candidate
			}
		}
		throw new Error(
			`${label} executable not found at "${requested}". Check the executable path in the provider settings.`,
		)
	}

	for (const directory of getCliSearchDirectories()) {
		for (const candidate of executableCandidates(requested)) {
			const fullPath = path.join(directory, candidate)
			if (await isExecutableFile(fullPath)) {
				return fullPath
			}
		}
	}

	throw new Error(
		`${label} executable "${requested}" was not found in PATH. Install the ${label} CLI and sign in, or set the executable path in the provider settings.`,
	)
}
