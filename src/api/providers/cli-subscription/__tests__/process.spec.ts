import { buildCliEnvironment, CliProcessError, runJsonlProcess, type CliProcessItem } from "../process"

/** Runs a Node.js script as the "CLI" so the tests use a real child process on every platform. */
function runScript(
	script: string,
	options: { stdin?: string; signal?: AbortSignal; inactivityTimeoutMs?: number } = {},
) {
	return runJsonlProcess({
		executable: process.execPath,
		args: ["-e", script],
		cwd: process.cwd(),
		stdin: options.stdin,
		signal: options.signal,
		inactivityTimeoutMs: options.inactivityTimeoutMs ?? 10_000,
		label: "Test CLI",
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
	})
}

async function collect(stream: AsyncGenerator<CliProcessItem>): Promise<CliProcessItem[]> {
	const items: CliProcessItem[] = []
	for await (const item of stream) items.push(item)
	return items
}

describe("runJsonlProcess", () => {
	it("yields parsed JSON lines, then the exit status with stderr and non-JSON lines", async () => {
		const items = await collect(
			runScript(`
				process.stdout.write('{"a":1}\\nnot json\\n{"b":');
				setTimeout(() => { process.stdout.write('2}\\n'); process.stderr.write('warn'); process.exit(3) }, 20)
			`),
		)
		expect(items.slice(0, 2)).toEqual([
			{ type: "event", value: { a: 1 } },
			{ type: "event", value: { b: 2 } },
		])
		expect(items[2]).toMatchObject({ type: "exit", exitCode: 3, stderr: "warn", nonJsonLines: ["not json"] })
	})

	it("writes stdin and closes it", async () => {
		const items = await collect(
			runScript(
				`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.stringify({got:s})))`,
				{ stdin: "hello\n" },
			),
		)
		expect(items[0]).toEqual({ type: "event", value: { got: "hello\n" } })
	})

	it("stops the process and throws when the signal aborts", async () => {
		const controller = new AbortController()
		const stream = runScript(`console.log('{"ready":true}'); setInterval(() => {}, 1000)`, {
			signal: controller.signal,
		})
		const first = await stream.next()
		expect(first.value).toEqual({ type: "event", value: { ready: true } })
		controller.abort()
		await expect(stream.next()).rejects.toMatchObject({ reason: "aborted" })
	})

	it("throws at once when the signal is already aborted", async () => {
		const controller = new AbortController()
		controller.abort()
		await expect(collect(runScript("", { signal: controller.signal }))).rejects.toBeInstanceOf(CliProcessError)
	})

	it("stops a process that writes nothing for too long", async () => {
		await expect(
			collect(runScript("setInterval(() => {}, 1000)", { inactivityTimeoutMs: 200 })),
		).rejects.toMatchObject({
			reason: "inactive",
		})
	})

	it("reports a missing executable", async () => {
		const stream = runJsonlProcess({
			executable: "/definitely/not/a/real/cli",
			args: [],
			cwd: process.cwd(),
			inactivityTimeoutMs: 0,
			label: "Test CLI",
		})
		await expect(collect(stream)).rejects.toMatchObject({ reason: "spawn" })
	})
})

describe("buildCliEnvironment", () => {
	it("removes extension-host variables and keeps the rest", () => {
		const env = buildCliEnvironment({
			PATH: "/bin",
			HOME: "/home/u",
			ELECTRON_RUN_AS_NODE: "1",
			NODE_OPTIONS: "--inspect",
			VSCODE_PID: "1",
		})
		expect(env).toEqual({ PATH: "/bin", HOME: "/home/u", NO_COLOR: "1" })
	})
})
