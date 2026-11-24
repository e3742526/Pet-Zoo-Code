import { promises as fs } from "fs"
import * as os from "os"
import * as path from "path"

export interface FakeCliRecord {
	argv: string[]
	cwd: string
	stdin: string
	/** Contents of the file passed with --prompt-file, read while the CLI ran. */
	promptFile?: { path: string; content: string }
}

export interface FakeCliRun {
	lines: unknown[]
	stderr?: string
	exitCode?: number
}

export interface FakeCli {
	executable: string
	/**
	 * Sets the JSONL output, stderr, and exit code. Pass an array to script consecutive runs; the
	 * last entry repeats.
	 */
	script(output: FakeCliRun | FakeCliRun[]): Promise<void>
	/** Record of the most recent run. */
	record(): Promise<FakeCliRecord>
	/** Records of every run, oldest first. */
	records(): Promise<FakeCliRecord[]>
	dispose(): Promise<void>
}

/**
 * Creates an executable Node.js script that acts as a CLI: it records its arguments, working
 * directory, stdin, and prompt file, then prints scripted JSONL. POSIX only (uses a shebang).
 */
export async function createFakeCli(): Promise<FakeCli> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-fake-cli-"))
	const executable = path.join(directory, "fake-cli")
	const outputFile = path.join(directory, "output.json")
	const recordFile = path.join(directory, "records.jsonl")

	const source = `#!${process.execPath}
const fs = require("fs")
const argv = process.argv.slice(2)
let stdin = ""
process.stdin.on("data", (chunk) => (stdin += chunk))
process.stdin.on("end", () => {
	const index = argv.indexOf("--prompt-file")
	const promptFile = index >= 0 ? { path: argv[index + 1], content: fs.readFileSync(argv[index + 1], "utf8") } : undefined
	fs.appendFileSync(${JSON.stringify(recordFile)}, JSON.stringify({ argv, cwd: process.cwd(), stdin, promptFile }) + "\\n")
	const runIndex = fs.readFileSync(${JSON.stringify(recordFile)}, "utf8").trim().split("\\n").length - 1
	const scripted = JSON.parse(fs.readFileSync(${JSON.stringify(outputFile)}, "utf8"))
	const output = Array.isArray(scripted) ? scripted[Math.min(runIndex, scripted.length - 1)] : scripted
	for (const line of output.lines) process.stdout.write(JSON.stringify(line) + "\\n")
	if (output.stderr) process.stderr.write(output.stderr)
	process.exitCode = output.exitCode ?? 0
})
`
	await fs.writeFile(executable, source, { mode: 0o755 })

	const records = async (): Promise<FakeCliRecord[]> =>
		(await fs.readFile(recordFile, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as FakeCliRecord)

	return {
		executable,
		script: (output) => fs.writeFile(outputFile, JSON.stringify(output)),
		records,
		record: async () => {
			const all = await records()
			return all[all.length - 1]
		},
		dispose: () => fs.rm(directory, { recursive: true, force: true }),
	}
}
