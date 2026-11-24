// npx vitest __tests__/dist_assets.spec.ts

import * as fs from "fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import * as path from "path"
import * as yaml from "yaml"
import workerpool from "workerpool"

import manifest from "../package.json"

describe("dist assets", () => {
	const distPath = path.join(__dirname, "../dist")
	const marketplaceAssetsPath = path.join(__dirname, "../assets/marketplace")
	const webviewAssetsPath = path.join(__dirname, "../webview-ui/build/assets")

	it("registers the fork under its own extension and settings IDs", () => {
		expect(`${manifest.publisher}.${manifest.name}`).toBe("e3742526.pet-zoo-code")
		expect(manifest.contributes.viewsContainers.activitybar.map(({ id }) => id)).toEqual([
			"pet-zoo-code-ActivityBar",
		])
		expect(manifest.contributes.views["pet-zoo-code-ActivityBar"].map(({ id }) => id)).toEqual([
			"pet-zoo-code.SidebarProvider",
		])
		for (const { command } of manifest.contributes.commands) {
			expect(command).toMatch(/^pet-zoo-code\./)
		}
		for (const setting of Object.keys(manifest.contributes.configuration.properties)) {
			expect(setting).toMatch(/^pet-zoo-code\./)
		}
	})

	it("excludes retired Zoo Gateway, Zoo Pass, account, and analytics URLs from both runtimes", () => {
		const retiredEndpoints =
			/https?:\/\/(?:(?:app|clerk)\.roocode\.com\b|(?:[\w-]+\.)*posthog\.com\b|(?:www\.)?zoocode\.dev\/pass\b)|\/api\/(?:gateway\/v1|extension\/auth\/(?:verify|revoke))\b/g
		const webviewScripts = fs
			.readdirSync(webviewAssetsPath)
			.filter((filename) => filename.endsWith(".js"))
			.map((filename) => path.join(webviewAssetsPath, filename))
		expect(webviewScripts.length).toBeGreaterThan(0)

		for (const file of [path.join(distPath, "extension.js"), ...webviewScripts]) {
			const source = fs.readFileSync(file, "utf8")
			expect(source.match(retiredEndpoints) ?? [], path.relative(path.join(__dirname, ".."), file)).toEqual([])
		}
	})

	describe("tiktoken", () => {
		const encodingFilename = "tiktoken_o200k_base.json"
		const workerPath = path.join(distPath, "workers", "countTokens.js")

		it("should have a single shared tiktoken wasm file", () => {
			expect(fs.existsSync(path.join(distPath, "tiktoken_bg.wasm"))).toBe(true)
			expect(fs.existsSync(path.join(distPath, "workers", "tiktoken_bg.wasm"))).toBe(false)
		})

		it("stores tokenizer ranks once outside the JavaScript bundles", () => {
			const encoding: { bpe_ranks: string } = JSON.parse(
				fs.readFileSync(path.join(distPath, encodingFilename), "utf8"),
			)
			const rankPrefix = JSON.stringify(encoding.bpe_ranks.slice(0, 256)).slice(1, -1)

			for (const file of [path.join(distPath, "extension.js"), workerPath]) {
				expect(fs.readFileSync(file, "utf8").includes(rankPrefix), path.basename(file)).toBe(false)
			}
			expect(fs.existsSync(path.join(distPath, "workers", encodingFilename))).toBe(false)
		})

		it("counts tokens using only the copied worker and its shared assets", async () => {
			const root = fs.mkdtempSync(path.join(tmpdir(), "zoo-code-tokenizer-"))
			try {
				const workersDir = path.join(root, "workers")
				const script = path.join(workersDir, "countTokens.js")
				fs.mkdirSync(workersDir)
				fs.copyFileSync(workerPath, script)
				for (const filename of ["tiktoken_bg.wasm", encodingFilename]) {
					fs.copyFileSync(path.join(distPath, filename), path.join(root, filename))
				}

				const pool = workerpool.pool(script, { maxWorkers: 1 })
				try {
					await expect(pool.exec("countTokens", [[{ type: "text", text: "Hello world" }]])).resolves.toEqual({
						success: true,
						count: 3,
					})
				} finally {
					await pool.terminate(true)
				}
			} finally {
				fs.rmSync(root, { recursive: true, force: true })
			}
		})
	})

	it("bundles and runs a TypeScript tool with the compressed compiler", () => {
		expect(fs.existsSync(path.join(distPath, "esbuild.wasm.br"))).toBe(true)
		expect(fs.existsSync(path.join(distPath, "esbuild.wasm"))).toBe(false)

		const workspace = fs.mkdtempSync(path.join(tmpdir(), "zoo-code-compiler-"))
		try {
			const input = path.join(workspace, "tool.ts")
			const output = path.join(workspace, "tool.mjs")
			const dependency = path.join(workspace, "node_modules", "tool-example")
			fs.mkdirSync(dependency, { recursive: true })
			fs.writeFileSync(path.join(dependency, "index.js"), "module.exports = { multiplier: 7 }")
			fs.writeFileSync(path.join(workspace, "values.ts"), "export enum Values { Input = 6 }")
			fs.writeFileSync(
				input,
				[
					'import { Values } from "./values.js"',
					'import toolExample from "tool-example"',
					"console.log(Values.Input * toolExample.multiplier)",
				].join("\n"),
			)

			execFileSync(
				process.execPath,
				[
					path.join(distPath, "bin", "esbuild"),
					input,
					"--bundle",
					"--format=esm",
					"--platform=node",
					"--target=node18",
					`--outfile=${output}`,
				],
				{ cwd: workspace, timeout: 10_000 },
			)
			fs.rmSync(dependency, { recursive: true })
			expect(execFileSync(process.execPath, [output], { encoding: "utf8", timeout: 10_000 }).trim()).toBe("42")
		} finally {
			fs.rmSync(workspace, { recursive: true, force: true })
		}
	}, 25_000)

	describe("tree-sitter", () => {
		const treeSitterFiles = [
			"tree-sitter-cpp.wasm",
			"tree-sitter-c_sharp.wasm",
			"tree-sitter-css.wasm",
			"tree-sitter-c.wasm",
			"tree-sitter-dart.wasm",
			"tree-sitter-elisp.wasm",
			"tree-sitter-elixir.wasm",
			"tree-sitter-embedded_template.wasm",
			"tree-sitter-go.wasm",
			"tree-sitter-html.wasm",
			"tree-sitter-javascript.wasm",
			"tree-sitter-java.wasm",
			"tree-sitter-kotlin.wasm",
			"tree-sitter-lua.wasm",
			"tree-sitter-ocaml.wasm",
			"tree-sitter-php.wasm",
			"tree-sitter-python.wasm",
			"tree-sitter-ruby.wasm",
			"tree-sitter-rust.wasm",
			"tree-sitter-scala.wasm",
			"tree-sitter-solidity.wasm",
			"tree-sitter-swift.wasm",
			"tree-sitter-systemrdl.wasm",
			"tree-sitter-tlaplus.wasm",
			"tree-sitter-toml.wasm",
			"tree-sitter-tsx.wasm",
			"tree-sitter-typescript.wasm",
			"tree-sitter-vue.wasm",
			"tree-sitter.wasm",
			"tree-sitter-zig.wasm",
		]

		const unusedTreeSitterFiles = [
			"tree-sitter-bash.wasm",
			"tree-sitter-elm.wasm",
			"tree-sitter-json.wasm",
			"tree-sitter-objc.wasm",
			"tree-sitter-ql.wasm",
			"tree-sitter-rescript.wasm",
			"tree-sitter-yaml.wasm",
		]

		test.each(treeSitterFiles)("should have %s file", (filename) => {
			expect(fs.existsSync(path.join(distPath, filename))).toBe(true)
		})

		test.each(unusedTreeSitterFiles)("should not package unused %s file", (filename) => {
			expect(fs.existsSync(path.join(distPath, filename))).toBe(false)
		})
	})

	describe("marketplace assets", () => {
		const marketplaceFiles = ["modes.yml", "mcps.yml"]

		test.each(marketplaceFiles)("should include bundled %s marketplace asset with multiple items", (filename) => {
			const assetPath = path.join(marketplaceAssetsPath, filename)
			expect(fs.existsSync(assetPath)).toBe(true)

			const parsed = yaml.parse(fs.readFileSync(assetPath, "utf-8"))
			expect(Array.isArray(parsed?.items)).toBe(true)
			expect(parsed.items.length).toBeGreaterThan(1)
		})
	})
})
