/**
 * CustomToolRegistry - A reusable class for dynamically loading and managing TypeScript tools.
 *
 * Features:
 * - Dynamic TypeScript/JavaScript tool loading with esbuild transpilation.
 * - Runtime validation of tool definitions.
 * - Tool execution with context.
 * - JSON Schema generation for LLM integration.
 */

import fs from "fs"
import path from "path"
import { createHash } from "crypto"
import os from "os"
import { pathToFileURL } from "url"

import type { CustomToolDefinition, SerializedCustomToolDefinition, CustomToolParametersSchema } from "@roo-code/types"

import type { StoredCustomTool, LoadResult } from "./types.js"
import { serializeCustomTool } from "./serialize.js"
import { runEsbuild, NODE_BUILTIN_MODULES, COMMONJS_REQUIRE_BANNER } from "./esbuild-runner.js"

function assertPrivateCacheEntry(filePath: string, stat: fs.Stats, kind: "directory" | "file"): void {
	const userId = process.getuid?.()
	const validType = kind === "directory" ? stat.isDirectory() : stat.isFile() && stat.nlink === 1
	if (!validType || (userId !== undefined && (stat.uid !== userId || (stat.mode & 0o077) !== 0))) {
		throw new Error(`Unsafe custom tool cache ${kind}: ${filePath}`)
	}
}

function resolveCacheDirectory(cachePath: string, create: boolean): string | undefined {
	const cacheName = path.basename(cachePath)
	if (!cacheName) throw new Error(`Unsafe custom tool cache directory: ${cachePath}`)

	const missingParts = [cacheName]
	let parent = path.dirname(cachePath)
	while (!fs.existsSync(parent)) {
		if (!create) return undefined
		missingParts.unshift(path.basename(parent))
		parent = path.dirname(parent)
	}

	// Use the canonical parent. Some systems place the user temp directory under a system link.
	let directory = fs.realpathSync(parent)
	const userId = process.getuid?.()
	if (userId !== undefined) {
		for (let ancestor = directory; ; ancestor = path.dirname(ancestor)) {
			const stat = fs.lstatSync(ancestor)
			const trustedOwner = stat.uid === 0 || stat.uid === userId
			const permitsReplacement = (stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0
			if (!stat.isDirectory() || !trustedOwner || permitsReplacement) {
				throw new Error(`Unsafe custom tool cache parent: ${ancestor}`)
			}
			if (ancestor === path.dirname(ancestor)) break
		}
	}

	for (const part of missingParts) {
		directory = path.join(directory, part)
		if (create) fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
		const stat = fs.lstatSync(directory, { throwIfNoEntry: false })
		if (!stat) return undefined
		assertPrivateCacheEntry(directory, stat, "directory")
	}
	return directory
}

function getCachedBundle(directory: string): string | undefined {
	const stat = fs.lstatSync(directory, { throwIfNoEntry: false })
	if (!stat) return undefined
	assertPrivateCacheEntry(directory, stat, "directory")

	const bundle = path.join(directory, "bundle.mjs")
	const bundleStat = fs.lstatSync(bundle, { throwIfNoEntry: false })
	if (!bundleStat) return undefined
	assertPrivateCacheEntry(bundle, bundleStat, "file")
	return bundle
}

export interface RegistryOptions {
	/** Directory for caching compiled TypeScript files. */
	cacheDir?: string
	/** Additional paths for resolving node modules (useful for tools outside node_modules). */
	nodePaths?: string[]
	/** Path to the extension root directory (for finding bundled esbuild binary in production). */
	extensionPath?: string
}

export class CustomToolRegistry {
	private tools = new Map<string, StoredCustomTool>()
	private readonly cacheDir: string
	private nodePaths: string[]
	private extensionPath?: string
	private lastLoaded: Map<string, number> = new Map()

	constructor(options?: RegistryOptions) {
		this.cacheDir = path.resolve(options?.cacheDir ?? path.join(os.homedir(), ".pet-zoo-code-tool-cache"))
		// Default to current working directory's node_modules.
		this.nodePaths = options?.nodePaths ?? [path.join(process.cwd(), "node_modules")]
		this.extensionPath = options?.extensionPath
	}

	/**
	 * Load all tools from a directory.
	 * Supports both .ts and .js files.
	 *
	 * @param toolDir - Absolute path to the tools directory
	 * @returns LoadResult with lists of loaded and failed tools
	 */
	async loadFromDirectory(toolDir: string): Promise<LoadResult> {
		const result: LoadResult = { loaded: [], failed: [] }

		try {
			if (!fs.existsSync(toolDir)) {
				return result
			}

			const files = fs.readdirSync(toolDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"))

			for (const file of files) {
				const filePath = path.join(toolDir, file)

				try {
					console.log(`[CustomToolRegistry] importing tool from ${filePath}`)
					const mod = await this.import(filePath)

					for (const [exportName, value] of Object.entries(mod)) {
						const def = this.validate(exportName, value)

						if (!def) {
							continue
						}

						this.tools.set(def.name, { ...def, source: filePath })
						console.log(`[CustomToolRegistry] loaded tool ${def.name} from ${filePath}`)
						result.loaded.push(def.name)
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					console.error(`[CustomToolRegistry] import(${filePath}) failed: ${message}`)
					result.failed.push({ file, error: message })
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			console.error(`[CustomToolRegistry] loadFromDirectory(${toolDir}) failed: ${message}`)
		}

		return result
	}

	async loadFromDirectoryIfStale(toolDir: string): Promise<LoadResult> {
		if (!fs.existsSync(toolDir)) {
			return { loaded: [], failed: [] }
		}

		const lastLoaded = this.lastLoaded.get(toolDir)
		const stat = fs.statSync(toolDir)
		const isStale = lastLoaded ? stat.mtimeMs > lastLoaded : true

		if (isStale) {
			this.lastLoaded.set(toolDir, stat.mtimeMs)
			return this.loadFromDirectory(toolDir)
		}

		return { loaded: this.list(), failed: [] }
	}

	/**
	 * Load all tools from multiple directories.
	 * Directories are processed in order, so later directories can override tools from earlier ones.
	 * Supports both .ts and .js files.
	 *
	 * @param toolDirs - Array of absolute paths to tools directories
	 * @returns LoadResult with lists of loaded and failed tools from all directories
	 */
	async loadFromDirectories(toolDirs: string[]): Promise<LoadResult> {
		const result: LoadResult = { loaded: [], failed: [] }

		for (const toolDir of toolDirs) {
			const dirResult = await this.loadFromDirectory(toolDir)
			result.loaded.push(...dirResult.loaded)
			result.failed.push(...dirResult.failed)
		}

		return result
	}

	/**
	 * Load all tools from multiple directories if any has become stale.
	 * Directories are processed in order, so later directories can override tools from earlier ones.
	 *
	 * @param toolDirs - Array of absolute paths to tools directories
	 * @returns LoadResult with lists of loaded and failed tools
	 */
	async loadFromDirectoriesIfStale(toolDirs: string[]): Promise<LoadResult> {
		const result: LoadResult = { loaded: [], failed: [] }

		for (const toolDir of toolDirs) {
			const dirResult = await this.loadFromDirectoryIfStale(toolDir)
			result.loaded.push(...dirResult.loaded)
			result.failed.push(...dirResult.failed)
		}

		return result
	}

	/**
	 * Register a tool directly (without loading from file).
	 */
	register(definition: CustomToolDefinition, source?: string): void {
		const { name: id } = definition
		const validated = this.validate(id, definition)

		if (!validated) {
			throw new Error(`Invalid tool definition for '${id}'`)
		}

		const storedTool: StoredCustomTool = source ? { ...validated, source } : validated
		this.tools.set(id, storedTool)
	}

	/**
	 * Unregister a tool by ID.
	 */
	unregister(id: string): boolean {
		return this.tools.delete(id)
	}

	/**
	 * Get a tool by ID.
	 */
	get(id: string): CustomToolDefinition | undefined {
		return this.tools.get(id)
	}

	/**
	 * Check if a tool exists.
	 */
	has(id: string): boolean {
		return this.tools.has(id)
	}

	/**
	 * Get all registered tool IDs.
	 */
	list(): string[] {
		return Array.from(this.tools.keys())
	}

	/**
	 * Get all registered tools.
	 */
	getAll(): CustomToolDefinition[] {
		return Array.from(this.tools.values())
	}

	/**
	 * Get all registered tools in the serialized format.
	 */
	getAllSerialized(): SerializedCustomToolDefinition[] {
		return this.getAll().map(serializeCustomTool)
	}

	/**
	 * Get the number of registered tools.
	 */
	get size(): number {
		return this.tools.size
	}

	/**
	 * Clear all registered tools.
	 */
	clear(): void {
		this.tools.clear()
	}

	/**
	 * Set the extension path for finding bundled esbuild binary.
	 * This should be called with context.extensionPath when the extension activates.
	 */
	setExtensionPath(extensionPath: string): void {
		this.extensionPath = extensionPath
	}

	/**
	 * Get the current extension path.
	 */
	getExtensionPath(): string | undefined {
		return this.extensionPath
	}

	/**
	 * Remove published TypeScript compilation cache entries.
	 */
	clearCache(): void {
		try {
			const cacheDir = resolveCacheDirectory(this.cacheDir, false)
			if (!cacheDir) return

			for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
				if (/^[a-f0-9]{16}$/.test(entry.name)) {
					fs.rmSync(path.join(cacheDir, entry.name), { recursive: true, force: true })
				}
			}
		} catch (error) {
			console.error(
				`[CustomToolRegistry] clearCache failed to clean disk cache: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Dynamically import a TypeScript or JavaScript file.
	 * TypeScript files are transpiled on-the-fly using esbuild.
	 *
	 * For TypeScript files, esbuild bundles the code with these considerations:
	 * - Node.js built-in modules (fs, path, etc.) are kept external
	 * - npm packages are bundled with a CommonJS shim for require() compatibility
	 * - The tool's local node_modules is included in the resolution path
	 */
	private async import(filePath: string): Promise<Record<string, CustomToolDefinition>> {
		const absolutePath = path.resolve(filePath)
		const ext = path.extname(absolutePath)

		if (ext === ".js" || ext === ".mjs") {
			return import(pathToFileURL(absolutePath).href)
		}

		const stat = fs.statSync(absolutePath)
		const cacheKey = `${absolutePath}:${stat.mtimeMs}`
		const cacheDir = resolveCacheDirectory(this.cacheDir, true)
		if (!cacheDir) {
			throw new Error(`Custom tool cache is unavailable: ${this.cacheDir}`)
		}

		const hash = createHash("sha256").update(cacheKey).digest("hex").slice(0, 16)
		const toolCacheDir = path.join(cacheDir, hash)
		const cachedBundle = getCachedBundle(toolCacheDir)
		if (cachedBundle) {
			return import(pathToFileURL(cachedBundle).href)
		}

		// Get the tool's directory to include its node_modules in resolution path.
		const toolDir = path.dirname(absolutePath)
		const toolNodeModules = path.join(toolDir, "node_modules")

		// Combine default nodePaths with tool-specific node_modules.
		// Tool's node_modules takes priority (listed first).
		const nodePaths = fs.existsSync(toolNodeModules) ? [toolNodeModules, ...this.nodePaths] : this.nodePaths

		// Publish the complete directory so a concurrent reader can only see a finished bundle and its .env files.
		const stagingDir = fs.mkdtempSync(path.join(cacheDir, ".build-"))
		try {
			const outfile = path.join(stagingDir, "bundle.mjs")
			await runEsbuild(
				{
					entryPoint: absolutePath,
					outfile,
					format: "esm",
					platform: "node",
					target: "node18",
					bundle: true,
					sourcemap: "inline",
					packages: "bundle",
					nodePaths,
					external: NODE_BUILTIN_MODULES,
					banner: COMMONJS_REQUIRE_BANNER,
				},
				this.extensionPath,
			)
			if (process.getuid) fs.chmodSync(outfile, 0o600)
			this.copyEnvFiles(toolDir, stagingDir)

			try {
				fs.renameSync(stagingDir, toolCacheDir)
			} catch (error) {
				// Another registry can finish first. Reuse its bundle only if it passes the same checks.
				if (!getCachedBundle(toolCacheDir)) throw error
			}

			const bundle = getCachedBundle(toolCacheDir)
			if (!bundle) throw new Error(`Custom tool bundle is unavailable: ${toolCacheDir}`)
			return import(pathToFileURL(bundle).href)
		} finally {
			fs.rmSync(stagingDir, { recursive: true, force: true })
		}
	}

	/**
	 * Copy .env files from the tool's source directory to the tool-specific cache directory.
	 * This allows tools that use dotenv with __dirname to find their .env files,
	 * while ensuring different tools' .env files don't overwrite each other.
	 *
	 * @param toolDir - The directory containing the tool source files
	 * @param destDir - The tool-specific cache directory to copy .env files to
	 */
	private copyEnvFiles(toolDir: string, destDir: string): void {
		try {
			const files = fs.readdirSync(toolDir)
			const envFiles = files.filter((f) => f === ".env" || f.startsWith(".env."))

			for (const envFile of envFiles) {
				const srcPath = path.join(toolDir, envFile)
				const destPath = path.join(destDir, envFile)

				// Only copy if source is a file (not a directory).
				const stat = fs.statSync(srcPath)
				if (stat.isFile()) {
					fs.copyFileSync(srcPath, destPath)
					if (process.getuid) fs.chmodSync(destPath, 0o600)
					console.log(`[CustomToolRegistry] copied ${envFile} to tool cache directory`)
				}
			}
		} catch (error) {
			// Non-fatal: log but don't fail if we can't copy env files.
			console.warn(
				`[CustomToolRegistry] failed to copy .env files: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Check if a value is a Zod schema by looking for the _def property
	 * which is present on all Zod types.
	 */
	private isParametersSchema(value: unknown): value is CustomToolParametersSchema {
		return (
			value !== null &&
			typeof value === "object" &&
			"_def" in value &&
			typeof (value as Record<string, unknown>)._def === "object"
		)
	}

	/**
	 * Validate a tool definition and return a typed result.
	 * Returns null for non-tool exports, throws for invalid tools.
	 */
	private validate(exportName: string, value: unknown): CustomToolDefinition | null {
		// Quick pre-check to filter out non-objects.
		if (!value || typeof value !== "object") {
			return null
		}

		// Check if it looks like a tool (has execute function).
		if (!("execute" in value) || typeof (value as Record<string, unknown>).execute !== "function") {
			return null
		}

		const obj = value as Record<string, unknown>
		const errors: string[] = []

		// Validate name.
		if (typeof obj.name !== "string") {
			errors.push("name: Expected string")
		} else if (obj.name.length === 0) {
			errors.push("name: Tool must have a non-empty name")
		}

		// Validate description.
		if (typeof obj.description !== "string") {
			errors.push("description: Expected string")
		} else if (obj.description.length === 0) {
			errors.push("description: Tool must have a non-empty description")
		}

		// Validate parameters (optional).
		if (obj.parameters !== undefined && !this.isParametersSchema(obj.parameters)) {
			errors.push("parameters: parameters must be a Zod schema")
		}

		if (errors.length > 0) {
			throw new Error(`Invalid tool definition for '${exportName}': ${errors.join(", ")}`)
		}

		return value as CustomToolDefinition
	}
}

export const customToolRegistry = new CustomToolRegistry()
