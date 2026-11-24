import * as fs from "fs/promises"
import * as path from "path"

const legacyBinaries: Record<string, string> = {
	"linux-x64": "semble",
	"linux-arm64": "semble",
	"darwin-arm64": "semble",
	"win32-x64": "semble.exe",
}
const legacyVersion = "v0.4.1"

/** Find the installation saved by an earlier version of the extension. */
export async function getSembleBinaryPath(storageDir: string): Promise<string | undefined> {
	const binary = legacyBinaries[`${process.platform}-${process.arch}`]
	if (!binary) {
		return undefined
	}

	const installationPath = path.join(storageDir, "semble")
	const binaryPath = path.join(installationPath, binary)

	try {
		const installedVersion = await fs.readFile(path.join(installationPath, ".semble-version"), "utf8")
		if (installedVersion.trim() !== legacyVersion) return undefined
		await fs.access(binaryPath)
		return binaryPath
	} catch {
		return undefined
	}
}
