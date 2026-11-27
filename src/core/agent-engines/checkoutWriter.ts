import { randomUUID } from "node:crypto"
import { mkdir, rmdir, readFile, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { executionHost, fingerprint } from "./process"

/**
 * Native runtimes can outlive an extension host crash. A reservation has no
 * automatic expiry. Remove it only after the adapter verifies shutdown.
 */
export async function claimAgentCheckout(root: string): Promise<() => Promise<void>> {
	const directory = path.join(tmpdir(), `dory-agent-writers-${executionHost.slice(0, 16)}`)
	await mkdir(directory, { recursive: true, mode: 0o700 })
	const reservation = path.join(directory, fingerprint(root))
	try {
		await mkdir(reservation, { mode: 0o700 })
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
		throw new Error("Another agent may still be active in this checkout. Check its task or running processes.")
	}
	const owner = randomUUID()
	const ownerFile = path.join(reservation, "owner.json")
	try {
		await writeFile(
			ownerFile,
			JSON.stringify({ owner, checkout: root, hostPid: process.pid, createdAt: Date.now() }),
			{
				flag: "wx",
				mode: 0o600,
			},
		)
	} catch (error) {
		await rmdir(reservation).catch(() => {})
		throw error
	}
	return async () => {
		const recorded: unknown = JSON.parse(await readFile(ownerFile, "utf8"))
		if (!recorded || typeof recorded !== "object" || !("owner" in recorded) || recorded.owner !== owner) {
			throw new Error("The checkout reservation changed.")
		}
		await unlink(ownerFile)
		await rmdir(reservation)
	}
}
