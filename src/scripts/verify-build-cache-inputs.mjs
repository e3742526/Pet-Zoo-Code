import { createProbe, turboGraph } from "./cache-probe.mjs"
import assert from "node:assert/strict"
import { appendFileSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"
import { test } from "node:test"

// Contract for the build/static Turbo tasks (issue #2290): changes to files
// and environment variables that feeds build outputs must invalidate the
// corresponding tasks, identical inputs must stay reusable, and unrelated
// environment must not disturb hashes.

const sharedConsumers = [
	"pet-zoo-code#build",
	"@roo-code/vscode-webview#build",
	"@roo-code/vscode-webview#check-types",
	"pet-zoo-code#bundle",
	"pet-zoo-code#check-types",
	"pet-zoo-code#vsix",
]

const webviewConsumers = [
	"@roo-code/vscode-webview#build",
	"@roo-code/vscode-webview#check-types",
	"pet-zoo-code#bundle",
	"pet-zoo-code#vsix",
]

const bundleConsumers = ["pet-zoo-code#bundle", "pet-zoo-code#vsix"]

// Keep this explicit: deriving consumers from the graph would hide a removed edge.
const typesConsumers = [
	"@roo-code/core#build",
	"@roo-code/ipc#build",
	"@roo-code/telemetry#build",
	"@roo-code/types#check-types",
	"@roo-code/vscode-webview#build",
	"@roo-code/vscode-webview#check-types",
	"pet-zoo-code#build",
	"pet-zoo-code#bundle",
	"pet-zoo-code#check-types",
	"pet-zoo-code#vsix",
]

const trackedTasks = ["@roo-code/types#build", ...typesConsumers]

const turboArgs = [
	"build",
	"check-types",
	"bundle",
	"vsix",
	"--filter=pet-zoo-code",
	"--filter=@roo-code/vscode-webview",
	"--filter=@roo-code/types",
]

let probeRoot

const hashes = (env = process.env) => {
	const graph = turboGraph(probeRoot, turboArgs, env)
	return Object.fromEntries(
		trackedTasks.map((taskName) => {
			const task = graph.tasks.find(({ taskId }) => taskId === taskName)
			if (!task) throw new Error(`Tracked task missing from Turbo graph: ${taskName}`)
			return [
				taskName,
				{
					hash: task.hash,
					inputs: Object.keys(task.inputs ?? {}),
					dependencies: task.dependencies,
					definition: task.resolvedTaskDefinition,
				},
			]
		}),
	)
}

const hashesOnly = (env = process.env) => Object.fromEntries(Object.entries(hashes(env)).map(([id, t]) => [id, t.hash]))

const changedTasks = (before, after) =>
	Object.keys(before)
		.filter((id) => before[id] !== after[id])
		.sort()

const withChangedFile = (path, mutate, run) => {
	const target = resolve(probeRoot, path)
	const original = readFileSync(target)
	try {
		mutate(target)
		return run()
	} finally {
		writeFileSync(target, original)
	}
}

const appendComment = (target) => appendFileSync(target, "\n// cache-input-test\n")

const expectChanged = (changed, expected, label) => {
	assert.deepEqual(
		changed,
		[...expected].sort(),
		`${label}: expected invalidation [${[...expected].sort().join(", ")}], got [${changed.join(", ") || "nothing"}]`,
	)
}

test("build cache input contract", async (context) => {
	const probe = createProbe()
	probeRoot = probe.probeRoot
	try {
		writeFileSync(resolve(probeRoot, ".env"), "CACHE_PROBE=before\n")
		for (const file of ["README.md", "LICENSE"]) writeFileSync(resolve(probeRoot, "src", file), "cache probe\n")
		mkdirSync(resolve(probeRoot, "src/dist"), { recursive: true })
		writeFileSync(resolve(probeRoot, "src/dist/cache-probe.js"), "// probe\n")
		await context.test("identical inputs keep hashes stable so reuse is permitted", () => {
			const first = hashesOnly()
			const second = hashesOnly()
			assert.deepEqual(first, second)
		})

		await context.test("webview build and typecheck hash the shared extension source", () => {
			const before = hashesOnly()
			const after = withChangedFile("src/shared/package.ts", appendComment, hashesOnly)
			expectChanged(changedTasks(before, after), sharedConsumers, "shared source edit")
		})

		for (const path of [
			"src/core/prompts/sections/custom-instructions.ts",
			"src/services/roo-config/index.ts",
			"src/services/destructive-command-guard/runner.ts",
		]) {
			await context.test(`webview build and typecheck hash shared imports outside src/shared: ${path}`, () => {
				const before = hashesOnly()
				const after = withChangedFile(path, appendComment, hashesOnly)
				expectChanged(changedTasks(before, after), sharedConsumers, `${path} edit`)
			})
		}

		await context.test("webview build hashes its entry HTML", () => {
			const before = hashesOnly()
			const after = withChangedFile("webview-ui/index.html", appendComment, hashesOnly)
			expectChanged(changedTasks(before, after), webviewConsumers, "index.html edit")
		})

		await context.test("webview build hashes the extension package version", () => {
			const before = hashesOnly()
			const after = withChangedFile(
				"src/package.json",
				(target) => {
					const pkg = JSON.parse(readFileSync(target, "utf8"))
					pkg.version = "0.0.0-cache-input-test"
					writeFileSync(target, JSON.stringify(pkg, null, "\t"))
				},
				hashesOnly,
			)
			expectChanged(changedTasks(before, after), sharedConsumers, "package version bump")
		})

		await context.test("extension bundle hashes repo-root packaging files", () => {
			for (const path of ["README.md", "CHANGELOG.md", "LICENSE"]) {
				const before = hashesOnly()
				const after = withChangedFile(path, appendComment, hashesOnly)
				expectChanged(changedTasks(before, after), bundleConsumers, `${path} edit`)
			}
		})

		await context.test("extension bundle hashes webview audio assets", () => {
			const before = hashesOnly()
			const after = withChangedFile(
				"webview-ui/audio/celebration.wav",
				(target) => appendFileSync(target, "\0"),
				hashesOnly,
			)
			expectChanged(changedTasks(before, after), webviewConsumers, "audio asset edit")
		})

		await context.test("release and debug env inputs invalidate the builds they feed", () => {
			const before = hashesOnly()
			const channel = hashesOnly({ ...process.env, PKG_RELEASE_CHANNEL: "prerelease" })
			expectChanged(
				changedTasks(before, channel),
				["@roo-code/vscode-webview#build", "pet-zoo-code#bundle", "pet-zoo-code#vsix"],
				"PKG_RELEASE_CHANNEL change",
			)
			const textmate = hashesOnly({ ...process.env, VSCODE_TEXTMATE_DEBUG: "1" })
			expectChanged(
				changedTasks(before, textmate),
				["@roo-code/vscode-webview#build", "pet-zoo-code#bundle", "pet-zoo-code#vsix"],
				"VSCODE_TEXTMATE_DEBUG change",
			)
		})

		await context.test("bundle declares the release channel as an embedded input", () => {
			const bundle = hashes()["pet-zoo-code#bundle"]
			assert.deepEqual(bundle.definition.env, ["PKG_RELEASE_CHANNEL"])
		})
		await context.test("VSIX hashes both bundle inputs without running the development bundle", () => {
			const tasks = hashes()
			const vsix = tasks["pet-zoo-code#vsix"]
			assert.deepEqual(vsix.dependencies, tasks["pet-zoo-code#bundle"].dependencies)
			assert.deepEqual(vsix.definition.env, ["PKG_RELEASE_CHANNEL", "VSCODE_TEXTMATE_DEBUG"])
		})
		await context.test("files regenerated during packaging do not invalidate the VSIX", () => {
			const before = hashesOnly()
			const after = withChangedFile("src/dist/cache-probe.js", appendComment, hashesOnly)
			assert.deepEqual(changedTasks(before, after), [])
		})
		await context.test("optional root .env is hashed", () => {
			const before = hashesOnly()
			const after = withChangedFile(".env", appendComment, hashesOnly)
			expectChanged(changedTasks(before, after), bundleConsumers, ".env change")
		})
		await context.test("unrelated env stays out of every task hash", () => {
			const before = hashesOnly()
			const after = hashesOnly({ ...process.env, ZOO_UNRELATED_CACHE_PROBE: "1" })
			assert.deepEqual(changedTasks(before, after), [])
		})

		await context.test("types source changes invalidate every dependent task", () => {
			const before = hashesOnly()
			const after = withChangedFile("packages/types/src/index.ts", appendComment, hashesOnly)
			expectChanged(changedTasks(before, after), trackedTasks, "types source edit")
		})

		await context.test("typechecks depend on the types build", () => {
			const tasks = hashes()
			for (const name of ["pet-zoo-code#check-types", "@roo-code/vscode-webview#check-types"]) {
				assert.deepEqual(tasks[name].dependencies, ["@roo-code/types#build"], name)
			}
		})
		await context.test("build tasks retain their scheduling dependencies", () => {
			const tasks = hashes()
			for (const name of typesConsumers.filter((name) => name.endsWith("#build"))) {
				assert.ok(tasks[name].dependencies.includes("@roo-code/types#build"), `${name} must wait for types`)
			}
			for (const dependency of [
				"@roo-code/build#build",
				"@roo-code/core#build",
				"@roo-code/ipc#build",
				"@roo-code/telemetry#build",
			]) {
				assert.ok(
					tasks["pet-zoo-code#build"].dependencies.includes(dependency),
					`pet-zoo-code#build must wait for ${dependency}`,
				)
			}
		})
		await context.test("hashed input sets contain exact corrected paths", () => {
			const tasks = hashes()
			const required = {
				"@roo-code/vscode-webview#build": [
					"index.html",
					"vite.config.ts",
					"../src/shared/package.ts",
					"../src/package.json",
				],
				"@roo-code/vscode-webview#check-types": ["../src/package.json"],
				"pet-zoo-code#bundle": [
					"../README.md",
					"../CHANGELOG.md",
					"../LICENSE",
					"../.env",
					"../webview-ui/audio/celebration.wav",
					"esbuild.mjs",
				],
				"pet-zoo-code#vsix": [
					"../README.md",
					"../CHANGELOG.md",
					"../LICENSE",
					"../.env",
					"../webview-ui/audio/celebration.wav",
					"package.nls.json",
					"esbuild.mjs",
				],
			}
			for (const [name, entries] of Object.entries(required)) {
				const inputs = tasks[name].inputs.map((input) => input.replaceAll("\\", "/"))
				for (const entry of entries) assert.ok(inputs.includes(entry), `${name} does not hash ${entry}`)
			}
		})
		await context.test("build and packaging tasks declare every cached output", () => {
			const tasks = hashes()
			const expected = {
				"@roo-code/types#build": ["dist/**"],
				"pet-zoo-code#build": ["dist/**"],
				"@roo-code/vscode-webview#build": ["../src/webview-ui/**"],
				"pet-zoo-code#bundle": [
					"CHANGELOG.md",
					"LICENSE",
					"README.md",
					"assets/vscode-material-icons/**",
					"dist/**",
					"webview-ui/audio/**",
				],
				"pet-zoo-code#vsix": ["../bin/**"],
			}
			for (const [name, outputs] of Object.entries(expected)) {
				assert.deepEqual(tasks[name].definition.outputs, outputs, `${name} cached outputs`)
			}
		})
	} finally {
		probe.cleanup()
	}
})
