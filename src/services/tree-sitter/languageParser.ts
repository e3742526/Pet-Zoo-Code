import * as path from "path"
import { Parser as ParserT, Language as LanguageT, Query as QueryT } from "web-tree-sitter"
import {
	javascriptQuery,
	typescriptQuery,
	tsxQuery,
	pythonQuery,
	rustQuery,
	goQuery,
	cppQuery,
	cQuery,
	csharpQuery,
	rubyQuery,
	javaQuery,
	phpQuery,
	htmlQuery,
	swiftQuery,
	kotlinQuery,
	cssQuery,
	ocamlQuery,
	solidityQuery,
	tomlQuery,
	vueQuery,
	luaQuery,
	systemrdlQuery,
	tlaPlusQuery,
	zigQuery,
	embeddedTemplateQuery,
	elispQuery,
	elixirQuery,
	dartQuery,
} from "./queries"

export interface LanguageParser {
	[key: string]: {
		parser: ParserT
		query: QueryT
	}
}

const languageCache = new Map<string, Promise<LanguageT>>()
const parserQueryCache = new Map<string, { parserKey: string; entry: { parser: ParserT; query: QueryT } }>()

async function loadLanguage(langName: string, sourceDirectory?: string): Promise<LanguageT> {
	const baseDir = sourceDirectory || __dirname
	const wasmPath = path.join(baseDir, `tree-sitter-${langName}.wasm`)

	const cached = languageCache.get(wasmPath)
	if (cached) {
		return cached
	}

	const { Language } = require("web-tree-sitter")
	const promise = (Language.load(wasmPath) as Promise<LanguageT>).catch((error: unknown) => {
		languageCache.delete(wasmPath)
		console.error(`Error loading language: ${wasmPath}: ${error instanceof Error ? error.message : error}`)
		throw error
	})

	languageCache.set(wasmPath, promise)
	return promise
}

let parserInitialization: Promise<void> | undefined

/*
Using node bindings for tree-sitter is problematic in vscode extensions 
because of incompatibility with electron. Going the .wasm route has the 
advantage of not having to build for multiple architectures.

We use web-tree-sitter and tree-sitter-wasms which provides auto-updating
prebuilt WASM binaries for tree-sitter's language parsers.

This function loads WASM modules for relevant language parsers based on input files:
1. Extracts unique file extensions
2. Maps extensions to language names
3. Loads corresponding WASM files (containing grammar rules)
4. Uses WASM modules to initialize tree-sitter parsers

This approach optimizes performance by loading only necessary parsers once for all relevant files.

Sources:
- https://github.com/tree-sitter/node-tree-sitter/issues/169
- https://github.com/tree-sitter/node-tree-sitter/issues/168
- https://github.com/Gregoor/tree-sitter-wasms/blob/main/README.md
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/query-test.js
*/
export async function loadRequiredLanguageParsers(filesToParse: string[], sourceDirectory?: string) {
	const { Parser, Query } = require("web-tree-sitter") as typeof import("web-tree-sitter")

	parserInitialization ??= Parser.init().catch((error: unknown) => {
		parserInitialization = undefined
		console.error(`Error initializing parser: ${error instanceof Error ? error.message : error}`)
		throw error
	})
	await parserInitialization

	const extensionsToLoad = new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)))
	const baseDir = sourceDirectory || __dirname
	const parsers: LanguageParser = {}

	for (const ext of extensionsToLoad) {
		const cacheKey = `${baseDir}::${ext}`
		const cachedParser = parserQueryCache.get(cacheKey)
		if (cachedParser) {
			parsers[cachedParser.parserKey] = cachedParser.entry
			continue
		}

		let language: LanguageT
		let querySource: string
		let parserKey = ext // Default to using extension as key

		switch (ext) {
			case "js":
			case "jsx":
			case "json":
				language = await loadLanguage("javascript", sourceDirectory)
				querySource = javascriptQuery
				break
			case "ts":
				language = await loadLanguage("typescript", sourceDirectory)
				querySource = typescriptQuery
				break
			case "tsx":
				language = await loadLanguage("tsx", sourceDirectory)
				querySource = tsxQuery
				break
			case "py":
				language = await loadLanguage("python", sourceDirectory)
				querySource = pythonQuery
				break
			case "rs":
				language = await loadLanguage("rust", sourceDirectory)
				querySource = rustQuery
				break
			case "go":
				language = await loadLanguage("go", sourceDirectory)
				querySource = goQuery
				break
			case "cpp":
			case "hpp":
				language = await loadLanguage("cpp", sourceDirectory)
				querySource = cppQuery
				break
			case "c":
			case "h":
				language = await loadLanguage("c", sourceDirectory)
				querySource = cQuery
				break
			case "cs":
				language = await loadLanguage("c_sharp", sourceDirectory)
				querySource = csharpQuery
				break
			case "rb":
				language = await loadLanguage("ruby", sourceDirectory)
				querySource = rubyQuery
				break
			case "java":
				language = await loadLanguage("java", sourceDirectory)
				querySource = javaQuery
				break
			case "php":
				language = await loadLanguage("php", sourceDirectory)
				querySource = phpQuery
				break
			case "swift":
				language = await loadLanguage("swift", sourceDirectory)
				querySource = swiftQuery
				break
			case "kt":
			case "kts":
				language = await loadLanguage("kotlin", sourceDirectory)
				querySource = kotlinQuery
				break
			case "css":
				language = await loadLanguage("css", sourceDirectory)
				querySource = cssQuery
				break
			case "html":
				language = await loadLanguage("html", sourceDirectory)
				querySource = htmlQuery
				break
			case "ml":
			case "mli":
				language = await loadLanguage("ocaml", sourceDirectory)
				querySource = ocamlQuery
				break
			case "scala":
				language = await loadLanguage("scala", sourceDirectory)
				querySource = luaQuery // Temporarily use Lua query until Scala is implemented
				break
			case "sol":
				language = await loadLanguage("solidity", sourceDirectory)
				querySource = solidityQuery
				break
			case "toml":
				language = await loadLanguage("toml", sourceDirectory)
				querySource = tomlQuery
				break
			case "vue":
				language = await loadLanguage("vue", sourceDirectory)
				querySource = vueQuery
				break
			case "lua":
				language = await loadLanguage("lua", sourceDirectory)
				querySource = luaQuery
				break
			case "rdl":
				language = await loadLanguage("systemrdl", sourceDirectory)
				querySource = systemrdlQuery
				break
			case "tla":
				language = await loadLanguage("tlaplus", sourceDirectory)
				querySource = tlaPlusQuery
				break
			case "zig":
				language = await loadLanguage("zig", sourceDirectory)
				querySource = zigQuery
				break
			case "ejs":
			case "erb":
				parserKey = "embedded_template" // Use same key for both extensions.
				language = await loadLanguage("embedded_template", sourceDirectory)
				querySource = embeddedTemplateQuery
				break
			case "el":
				language = await loadLanguage("elisp", sourceDirectory)
				querySource = elispQuery
				break
			case "ex":
			case "exs":
				language = await loadLanguage("elixir", sourceDirectory)
				querySource = elixirQuery
				break
			case "dart":
				language = await loadLanguage("dart", sourceDirectory)
				querySource = dartQuery
				break
			default:
				throw new Error(`Unsupported language: ${ext}`)
		}

		// A concurrent caller can finish loading the same grammar while we await it.
		const loadedParser = parserQueryCache.get(cacheKey)
		if (loadedParser) {
			parsers[loadedParser.parserKey] = loadedParser.entry
			continue
		}

		const query = new Query(language, querySource)
		const parser = new Parser()
		parser.setLanguage(language)
		const entry = { parser, query }
		parserQueryCache.set(cacheKey, { parserKey, entry })
		parsers[parserKey] = entry
	}

	return parsers
}
