import i18next, { type Resource } from "i18next"

// Build translations object
const translations: Resource = {}

// Determine if running in test environment
const isTestEnv = process.env.NODE_ENV === "test"

// Track languages already loaded from disk so each locale is read at most once
const loadedLanguages = new Set<string>()
let availableLanguages: Map<string, string> | null = null

function getLocalesDir(): string | null {
	try {
		const path = require("path")
		return path.join(__dirname, "i18n", "locales")
	} catch {
		return null
	}
}

function getAvailableLanguages(): Map<string, string> {
	if (availableLanguages) {
		return availableLanguages
	}

	availableLanguages = new Map<string, string>()

	try {
		const fs = require("fs")
		const localesDir = getLocalesDir()
		if (!localesDir) {
			return availableLanguages
		}

		const languageDirs = fs.readdirSync(localesDir, { withFileTypes: true })
		for (const dirent of languageDirs as Array<{ isDirectory: () => boolean; name: string }>) {
			if (dirent.isDirectory() && !dirent.name.startsWith(".")) {
				availableLanguages.set(dirent.name.toLowerCase(), dirent.name)
			}
		}
	} catch (dirError) {
		console.error("Error listing translation locales:", dirError)
	}

	return availableLanguages
}

function loadLanguageFromDisk(language: string): Record<string, Record<string, unknown>> | null {
	const localesDir = getLocalesDir()
	if (!localesDir) {
		return null
	}

	try {
		const fs = require("fs")
		const path = require("path")
		const langPath = path.join(localesDir, language)

		const files = (
			fs.readdirSync(langPath, { withFileTypes: true }) as Array<{ isFile: () => boolean; name: string }>
		)
			.filter((dirent) => dirent.isFile() && dirent.name.endsWith(".json") && !dirent.name.startsWith("."))
			.map((dirent) => dirent.name)

		const bundles: Record<string, Record<string, unknown>> = {}

		for (const file of files) {
			const namespace = path.basename(file, ".json")
			const filePath = path.join(langPath, file)

			try {
				const content = fs.readFileSync(filePath, "utf8")
				bundles[namespace] = JSON.parse(content)
			} catch (error) {
				console.error(`Error loading translation file ${filePath}:`, error)
			}
		}

		return bundles
	} catch (error) {
		console.error(`Error loading translations for language ${language}:`, error)
		return null
	}
}

/**
 * Lazily loads translation JSON files for the requested language (and its base
 * language fallback if regional, e.g. "fr-CA" -> "fr") so startup only reads
 * the active locale + "en" instead of all 18 locales synchronously.
 */
export function ensureLanguageLoaded(language: string): void {
	if (isTestEnv || !language) {
		return
	}

	const available = getAvailableLanguages()
	const candidates = [language]
	const baseLang = language.split("-")[0]
	if (baseLang && baseLang !== language) {
		candidates.push(baseLang)
	}

	for (const candidate of candidates) {
		const matchedDir = available.get(candidate.toLowerCase())
		if (!matchedDir || loadedLanguages.has(matchedDir)) {
			continue
		}

		loadedLanguages.add(matchedDir)
		const bundles = loadLanguageFromDisk(matchedDir)
		if (!bundles) {
			continue
		}

		for (const [namespace, data] of Object.entries(bundles)) {
			i18next.addResourceBundle(matchedDir, namespace, data, true, true)
			if (candidate !== matchedDir) {
				i18next.addResourceBundle(candidate, namespace, data, true, true)
			}
		}
	}
}

// Eagerly load only the fallback "en" locale at module import time
if (!isTestEnv) {
	const enBundles = loadLanguageFromDisk("en")
	if (enBundles) {
		translations["en"] = enBundles
		loadedLanguages.add("en")
	}
}

// Initialize i18next with configuration
i18next.init({
	lng: "en",
	fallbackLng: "en",
	debug: false,
	resources: translations,
	interpolation: {
		escapeValue: false,
	},
})

export default i18next
