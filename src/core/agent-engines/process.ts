import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createHash } from "node:crypto"
import { access, realpath } from "node:fs/promises"
import { constants } from "node:fs"
import { homedir, hostname } from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"

const run = promisify(execFile)

export function fingerprint(...values: string[]): string {
	return createHash("sha256").update(JSON.stringify(values)).digest("hex")
}

export const executionHost = fingerprint(hostname(), process.platform, process.arch, homedir())

export function nativeEnvironment(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {}
	for (const key of ["HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL"]) {
		const value = process.env[key]
		if (value !== undefined) env[key] = value
	}
	return env
}

export async function installedRuntime(name: string, version: string): Promise<string> {
	for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(path.isAbsolute)) {
		const candidate = path.join(directory, name)
		try {
			await access(candidate, constants.X_OK)
		} catch {
			continue
		}
		const { stdout } = await run(candidate, ["--version"], { env: nativeEnvironment(), timeout: 5000 })
		const installed = stdout.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/)?.[0]
		if (installed !== version)
			throw new Error(`Use ${name} ${version}. Detected ${installed ?? "an unknown version"}.`)
		return realpath(candidate)
	}
	throw new Error(`Install ${name} ${version} and make it available on the extension host PATH.`)
}

export async function runtimeStatus(
	executable: string,
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
): Promise<unknown> {
	try {
		const { stdout } = await run(executable, args, { cwd, env, timeout: 5000, maxBuffer: 65_536 })
		return JSON.parse(stdout)
	} catch {
		return undefined
	}
}

export function spawnNative(
	executable: string,
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
	return spawn(executable, args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] })
}

export class NativeShutdownError extends Error {}
export class NativeDisconnectedError extends Error {}

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
	try {
		process.kill(-pid, signal)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false
		throw new NativeShutdownError("Dory could not verify that the native process group stopped.")
	}
}

export async function closeNativeProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (!child.pid) return
	const pid = child.pid
	if (!signalGroup(pid, "SIGTERM")) return
	for (let attempt = 0; attempt < 12; attempt++) {
		await delay(50)
		if (!signalGroup(pid, attempt === 3 ? "SIGKILL" : 0)) return
	}
	throw new NativeShutdownError("The native process group is still active. Check the checkout before continuing.")
}

function workspaceGit(cwd: string, args: string[]) {
	return run("git", ["--no-optional-locks", "-C", cwd, ...args], {
		env: nativeEnvironment(),
		timeout: 5000,
		maxBuffer: 1024 * 1024,
	}).then(({ stdout }) => stdout.replace(/\r?\n$/, ""))
}

export async function checkoutRoot(cwd: string) {
	const root = await workspaceGit(cwd, ["rev-parse", "--show-toplevel"]).catch(() => cwd)
	return realpath(root)
}

export async function workspaceIdentity(directory: string) {
	const cwd = await realpath(directory)
	const git = (args: string[]) => workspaceGit(cwd, args)
	const [root, gitDir, branch] = await Promise.all([
		checkoutRoot(cwd),
		git(["rev-parse", "--absolute-git-dir"]).catch(() => ""),
		git(["symbolic-ref", "--quiet", "HEAD"]).catch(() => git(["rev-parse", "HEAD"]).catch(() => "")),
	])
	return { cwd, root, checkout: fingerprint(root, gitDir, branch), git }
}
