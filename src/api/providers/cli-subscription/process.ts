import { spawn, type ChildProcess } from "child_process"
import { StringDecoder } from "string_decoder"

/** Largest stdout line kept in memory. A longer line means the stream is not the expected JSONL. */
const MAX_LINE_BYTES = 64 * 1024 * 1024
/** Amount of stderr kept for diagnostics. */
const MAX_STDERR_CHARS = 16 * 1024
/** Time between SIGTERM and SIGKILL when a CLI does not stop. */
const KILL_GRACE_MS = 3_000

export interface CliProcessOptions {
	executable: string
	args: string[]
	cwd: string
	/** Text written to stdin before stdin is closed. */
	stdin?: string
	signal?: AbortSignal
	/** Stop the process when it writes nothing for this long. 0 turns the watchdog off. */
	inactivityTimeoutMs: number
	/** Human-readable CLI name for error messages. */
	label: string
	env?: NodeJS.ProcessEnv
}

export interface CliProcessExit {
	exitCode: number | null
	signal: NodeJS.Signals | null
	/** Last part of stderr, for diagnostics. */
	stderr: string
	/** stdout lines that were not JSON (kept for diagnostics). */
	nonJsonLines: string[]
}

export type CliProcessItem = { type: "event"; value: unknown } | ({ type: "exit" } & CliProcessExit)

export class CliProcessError extends Error {
	constructor(
		message: string,
		readonly reason: "spawn" | "aborted" | "inactive" | "output",
	) {
		super(message)
		this.name = "CliProcessError"
	}
}

/**
 * Environment for a CLI child process. Variables that make Electron or Node behave as the VS Code
 * extension host are removed so that the CLI starts as it does in a terminal.
 */
export function buildCliEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {}
	for (const [key, value] of Object.entries(base)) {
		if (key === "ELECTRON_RUN_AS_NODE" || key === "NODE_OPTIONS" || key.startsWith("VSCODE_")) {
			continue
		}
		env[key] = value
	}
	env.NO_COLOR = "1"
	return env
}

type Waiter = () => void

/**
 * Runs a CLI that writes JSON Lines to stdout and yields each parsed line, then one `exit` item.
 *
 * The process (and, on POSIX, its process group) is stopped when the signal aborts, when the
 * watchdog fires, or when the consumer stops iterating early.
 */
export async function* runJsonlProcess(options: CliProcessOptions): AsyncGenerator<CliProcessItem> {
	if (options.signal?.aborted) {
		throw new CliProcessError(`${options.label} request was cancelled.`, "aborted")
	}

	const useProcessGroup = process.platform !== "win32"
	let child: ChildProcess
	try {
		child = spawn(options.executable, options.args, {
			cwd: options.cwd,
			env: options.env ?? buildCliEnvironment(),
			stdio: ["pipe", "pipe", "pipe"],
			detached: useProcessGroup,
			windowsHide: true,
		})
	} catch (error) {
		throw new CliProcessError(
			`Could not start ${options.label} (${options.executable}): ${error instanceof Error ? error.message : String(error)}`,
			"spawn",
		)
	}

	const queue: CliProcessItem[] = []
	let failure: CliProcessError | undefined
	let exited = false
	let waiter: Waiter | undefined
	const wake = () => {
		const current = waiter
		waiter = undefined
		current?.()
	}

	let stderr = ""
	const nonJsonLines: string[] = []
	let partialLine = ""
	const decoder = new StringDecoder("utf8")

	const signalTree = (signal: NodeJS.Signals) => {
		try {
			if (useProcessGroup && child.pid !== undefined) {
				process.kill(-child.pid, signal)
			} else {
				child.kill(signal)
			}
		} catch {
			// The process already exited.
		}
	}
	const terminate = () => {
		if (exited) return
		signalTree("SIGTERM")
		const timer = setTimeout(() => {
			if (!exited) signalTree("SIGKILL")
		}, KILL_GRACE_MS)
		timer.unref?.()
	}
	const fail = (error: CliProcessError) => {
		if (!failure) failure = error
		terminate()
		wake()
	}

	let inactivityTimer: NodeJS.Timeout | undefined
	const resetWatchdog = () => {
		if (options.inactivityTimeoutMs <= 0) return
		if (inactivityTimer) clearTimeout(inactivityTimer)
		inactivityTimer = setTimeout(() => {
			fail(
				new CliProcessError(
					`${options.label} produced no output for ${Math.round(options.inactivityTimeoutMs / 1000)} seconds and was stopped.`,
					"inactive",
				),
			)
		}, options.inactivityTimeoutMs)
		inactivityTimer.unref?.()
	}

	const handleLine = (line: string) => {
		const trimmed = line.trim()
		if (!trimmed) return
		try {
			queue.push({ type: "event", value: JSON.parse(trimmed) as unknown })
		} catch {
			if (nonJsonLines.length < 20) nonJsonLines.push(trimmed.slice(0, 500))
		}
	}

	const onAbort = () => fail(new CliProcessError(`${options.label} request was cancelled.`, "aborted"))
	options.signal?.addEventListener("abort", onAbort, { once: true })

	child.stdout?.on("data", (chunk: Buffer) => {
		resetWatchdog()
		partialLine += decoder.write(chunk)
		let newline = partialLine.indexOf("\n")
		while (newline !== -1) {
			handleLine(partialLine.slice(0, newline))
			partialLine = partialLine.slice(newline + 1)
			newline = partialLine.indexOf("\n")
		}
		if (partialLine.length > MAX_LINE_BYTES) {
			partialLine = ""
			fail(new CliProcessError(`${options.label} wrote an output line that was too long.`, "output"))
		}
		wake()
	})
	child.stderr?.on("data", (chunk: Buffer) => {
		resetWatchdog()
		stderr = (stderr + chunk.toString("utf8")).slice(-MAX_STDERR_CHARS)
	})
	child.on("error", (error) => {
		fail(new CliProcessError(`Could not run ${options.label} (${options.executable}): ${error.message}`, "spawn"))
	})
	child.on("close", (exitCode, signal) => {
		exited = true
		partialLine += decoder.end()
		if (partialLine) {
			handleLine(partialLine)
			partialLine = ""
		}
		queue.push({ type: "exit", exitCode, signal, stderr, nonJsonLines })
		wake()
	})

	// A CLI that exits before reading stdin causes EPIPE; the exit status reports the real problem.
	child.stdin?.on("error", () => {})
	if (options.stdin !== undefined) {
		child.stdin?.write(options.stdin)
	}
	child.stdin?.end()
	resetWatchdog()

	try {
		while (true) {
			if (failure) throw failure
			const item = queue.shift()
			if (item) {
				yield item
				if (item.type === "exit") return
				continue
			}
			await new Promise<void>((resolve) => {
				waiter = resolve
			})
		}
	} finally {
		options.signal?.removeEventListener("abort", onAbort)
		if (inactivityTimer) clearTimeout(inactivityTimer)
		terminate()
	}
}
