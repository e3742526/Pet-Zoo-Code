import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import { brotliCompressSync, constants as zlibConstants } from "node:zlib"

function copyDir(srcDir: string, dstDir: string, count: number): number {
	const entries = fs.readdirSync(srcDir, { withFileTypes: true })

	for (const entry of entries) {
		const srcPath = path.join(srcDir, entry.name)
		const dstPath = path.join(dstDir, entry.name)

		if (entry.isDirectory()) {
			fs.mkdirSync(dstPath, { recursive: true })
			count = copyDir(srcPath, dstPath, count)
		} else {
			count = count + 1
			fs.copyFileSync(srcPath, dstPath)
		}
	}

	return count
}

function rmDir(dirPath: string, maxRetries: number = 5): void {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			fs.rmSync(dirPath, { recursive: true, force: true })
			return
		} catch (error) {
			const isLastAttempt = attempt === maxRetries

			const isRetryableError =
				error instanceof Error &&
				"code" in error &&
				(error.code === "ENOTEMPTY" ||
					error.code === "EBUSY" ||
					error.code === "EPERM" ||
					error.code === "EACCES")

			if (isLastAttempt) {
				// On the last attempt, try alternative cleanup methods.
				try {
					console.warn(`[rmDir] Final attempt using alternative cleanup for ${dirPath}`)

					// Try to clear readonly flags on Windows.
					if (process.platform === "win32") {
						try {
							execSync(`attrib -R "${dirPath}\\*.*" /S /D`, { stdio: "ignore" })
						} catch {
							// Ignore attrib errors.
						}
					}
					fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
					return
				} catch (finalError) {
					console.error(`[rmDir] Failed to remove ${dirPath} after ${maxRetries} attempts:`, finalError)
					throw finalError
				}
			}

			if (!isRetryableError) {
				throw error // Re-throw if it's not a retryable error.
			}

			// Wait with exponential backoff before retrying, with longer delays for Windows.
			const baseDelay = process.platform === "win32" ? 200 : 100
			const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 2000) // Cap at 2s
			console.warn(`[rmDir] Attempt ${attempt} failed for ${dirPath}, retrying in ${delay}ms...`)

			// Synchronous sleep for simplicity in build scripts.
			const start = Date.now()

			while (Date.now() - start < delay) {
				/* Busy wait */
			}
		}
	}
}

type CopyPathOptions = {
	optional?: boolean
}

export function copyPaths(copyPaths: [string, string, CopyPathOptions?][], srcDir: string, dstDir: string) {
	copyPaths.forEach(([srcRelPath, dstRelPath, options = {}]) => {
		try {
			const stats = fs.lstatSync(path.join(srcDir, srcRelPath))

			if (stats.isDirectory()) {
				if (fs.existsSync(path.join(dstDir, dstRelPath))) {
					rmDir(path.join(dstDir, dstRelPath))
				}

				fs.mkdirSync(path.join(dstDir, dstRelPath), { recursive: true })

				const count = copyDir(path.join(srcDir, srcRelPath), path.join(dstDir, dstRelPath), 0)
				console.log(`[copyPaths] Copied ${count} files from ${srcRelPath} to ${dstRelPath}`)
			} else {
				fs.copyFileSync(path.join(srcDir, srcRelPath), path.join(dstDir, dstRelPath))
				console.log(`[copyPaths] Copied ${srcRelPath} to ${dstRelPath}`)
			}
		} catch (error) {
			if (options.optional) {
				console.warn(`[copyPaths] Optional file not found: ${srcRelPath}`)
			} else {
				throw error
			}
		}
	})
}

// Language WASMs actually loaded by src/services/tree-sitter/languageParser.ts.
// Keeping this allowlist explicit prevents packaging ~10 MB of unused grammars
// (such as tree-sitter-objc.wasm, bash, rescript, ql, yaml, elm, json) into the VSIX.
const SUPPORTED_TREE_SITTER_LANGUAGE_WASMS = [
	"tree-sitter-c.wasm",
	"tree-sitter-c_sharp.wasm",
	"tree-sitter-cpp.wasm",
	"tree-sitter-css.wasm",
	"tree-sitter-dart.wasm",
	"tree-sitter-elisp.wasm",
	"tree-sitter-elixir.wasm",
	"tree-sitter-embedded_template.wasm",
	"tree-sitter-go.wasm",
	"tree-sitter-html.wasm",
	"tree-sitter-java.wasm",
	"tree-sitter-javascript.wasm",
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
	"tree-sitter-zig.wasm",
] as const

export function copyWasms(srcDir: string, distDir: string, { compressEsbuildWasm = true } = {}): void {
	const nodeModulesDir = path.join(srcDir, "node_modules")

	fs.mkdirSync(distDir, { recursive: true })

	// Single shared Tiktoken WASM file (used by both dist/extension.js and dist/workers/countTokens.js).
	fs.copyFileSync(
		path.join(nodeModulesDir, "tiktoken", "lite", "tiktoken_bg.wasm"),
		path.join(distDir, "tiktoken_bg.wasm"),
	)

	console.log(`[copyWasms] Copied tiktoken WASM to ${distDir}`)

	// Main tree-sitter WASM file.
	fs.copyFileSync(
		path.join(nodeModulesDir, "web-tree-sitter", "tree-sitter.wasm"),
		path.join(distDir, "tree-sitter.wasm"),
	)

	console.log(`[copyWasms] Copied tree-sitter.wasm to ${distDir}`)

	// Copy only supported language-specific WASM files.
	const languageWasmDir = path.join(nodeModulesDir, "tree-sitter-wasms", "out")

	if (!fs.existsSync(languageWasmDir)) {
		throw new Error(`Directory does not exist: ${languageWasmDir}`)
	}

	for (const filename of SUPPORTED_TREE_SITTER_LANGUAGE_WASMS) {
		const srcWasm = path.join(languageWasmDir, filename)
		if (!fs.existsSync(srcWasm)) {
			throw new Error(`Expected tree-sitter WASM file does not exist: ${srcWasm}`)
		}
		fs.copyFileSync(srcWasm, path.join(distDir, filename))
	}

	console.log(
		`[copyWasms] Copied ${SUPPORTED_TREE_SITTER_LANGUAGE_WASMS.length} tree-sitter language wasms to ${distDir}`,
	)

	// Package the offline compiler for custom tools.
	copyEsbuildWasmFiles(nodeModulesDir, distDir, compressEsbuildWasm)
}

function copyEsbuildWasmFiles(nodeModulesDir: string, distDir: string, compressWasm: boolean): void {
	const esbuildWasmDir = path.join(nodeModulesDir, "esbuild-wasm")

	if (!fs.existsSync(esbuildWasmDir)) {
		throw new Error(`Directory does not exist: ${esbuildWasmDir}`)
	}

	const binDir = path.join(distDir, "bin")
	fs.mkdirSync(binDir, { recursive: true })

	for (const filename of ["wasm_exec_node.js", "wasm_exec.js"]) {
		fs.copyFileSync(path.join(esbuildWasmDir, filename), path.join(distDir, filename))
	}

	const wasmSource = path.join(esbuildWasmDir, "esbuild.wasm")
	const launcherPath = path.join(binDir, "esbuild")
	let launcher = fs.readFileSync(path.join(esbuildWasmDir, "bin", "esbuild"), "utf8")
	if (compressWasm) {
		const wasmFilename = "'esbuild.wasm'"
		const compileModule = "new WebAssembly.Module(bytes)"
		if (!launcher.includes(wasmFilename) || !launcher.includes(compileModule)) {
			throw new Error("The esbuild-wasm launcher changed. Update the compressed compiler loader.")
		}

		// Decode the compiler in the child process only when a tool needs it.
		launcher = launcher
			.replace(wasmFilename, "'esbuild.wasm.br'")
			.replace(compileModule, "new WebAssembly.Module(require('node:zlib').brotliDecompressSync(bytes))")
		const compressed = brotliCompressSync(fs.readFileSync(wasmSource), {
			params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 },
		})
		fs.writeFileSync(path.join(distDir, "esbuild.wasm.br"), compressed)
	} else {
		fs.copyFileSync(wasmSource, path.join(distDir, "esbuild.wasm"))
	}

	// Initialize stdout and stderr before running WASM to avoid crbug.com/1201626.
	launcher = launcher.replace(
		/^(#!.*$)/m,
		"$1\n// Eagerly initialize stdout/stderr to avoid V8 crash (crbug.com/1201626) inside WASM stack\nconst _ = [process.stdout.fd, process.stderr.fd];",
	)
	fs.writeFileSync(launcherPath, launcher)
	try {
		fs.chmodSync(launcherPath, 0o755)
	} catch {
		// Ignore chmod errors on Windows.
	}

	console.log(`[copyWasms] Copied esbuild-wasm compiler to ${distDir}`)
}

export function copyLocales(srcDir: string, distDir: string): void {
	const destDir = path.join(distDir, "i18n", "locales")
	fs.mkdirSync(destDir, { recursive: true })
	const count = copyDir(path.join(srcDir, "i18n", "locales"), destDir, 0)
	console.log(`[copyLocales] Copied ${count} locale files to ${destDir}`)
}

export function setupLocaleWatcher(srcDir: string, distDir: string) {
	const localesDir = path.join(srcDir, "i18n", "locales")

	if (!fs.existsSync(localesDir)) {
		console.warn(`Cannot set up watcher: Source locales directory does not exist: ${localesDir}`)
		return
	}

	console.log(`Setting up watcher for locale files in ${localesDir}`)

	let debounceTimer: NodeJS.Timeout | null = null

	const debouncedCopy = () => {
		if (debounceTimer) {
			clearTimeout(debounceTimer)
		}

		// Wait 300ms after last change before copying.
		debounceTimer = setTimeout(() => {
			console.log("Locale files changed, copying...")
			copyLocales(srcDir, distDir)
		}, 300)
	}

	try {
		fs.watch(localesDir, { recursive: true }, (_eventType, filename) => {
			if (filename && filename.endsWith(".json")) {
				console.log(`Locale file ${filename} changed, triggering copy...`)
				debouncedCopy()
			}
		})
		console.log("Watcher for locale files is set up")
	} catch (error) {
		console.error(
			`Error setting up watcher for ${localesDir}:`,
			error instanceof Error ? error.message : "Unknown error",
		)
	}
}
