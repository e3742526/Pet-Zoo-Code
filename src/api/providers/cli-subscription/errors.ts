export interface CliFailureCommands {
	/** Command that signs the user in, for example `muse login`. */
	login: string
	/** Command that lists models, for example `agy models`. */
	listModels: string
	/** Command that shows the subscription allowance, when the CLI has one. */
	usage?: string
}

const MAX_DIAGNOSTIC_CHARS = 1_500

/** A provider rejected the turn because its allowance is exhausted. A short retry cannot fix it. */
export class ProviderQuotaExhaustedError extends Error {
	override readonly name = "ProviderQuotaExhaustedError"
}

/**
 * Gives a next step for a CLI failure. Diagnostics can echo prompt text or tool output, so only
 * known phrases are matched and the caller decides how much of the diagnostic to show.
 */
export function getCliFailureHint(diagnostic: string, commands: CliFailureCommands): string | undefined {
	const text = diagnostic.toLowerCase()
	const contains = (patterns: string[]) => patterns.some((pattern) => text.includes(pattern))

	if (
		contains([
			"missing meta credentials",
			"not logged in",
			"not signed in",
			"authentication expired",
			"unauthorized",
			"unauthenticated",
			"login required",
			"please log in",
			"please sign in",
		])
	) {
		return `Sign in again with \`${commands.login}\` in a terminal.`
	}
	if (
		contains([
			"subscription limit",
			"subscription allowance",
			"quota exceeded",
			"quota",
			"rate limit",
			"resource_exhausted",
			"resource exhausted",
		])
	) {
		return commands.usage
			? `The subscription allowance may be used up. Check it with \`${commands.usage}\`.`
			: "The subscription allowance or rate limit may be used up. Wait and try again."
	}
	if (
		contains(["unknown model", "model not found", "model is not available", "model unavailable", "invalid model"])
	) {
		return `The selected model is not available. List the available models with \`${commands.listModels}\`.`
	}
	if (contains(["connection refused", "failed to connect", "network error", "dns error", "timed out", "timeout"])) {
		return "The CLI reported a network problem. Check the connection and try again."
	}
	return undefined
}

/** Builds the error message for a failed CLI turn. */
export function formatCliFailure(
	label: string,
	summary: string,
	diagnostic: string,
	commands: CliFailureCommands,
): string {
	const hint = getCliFailureHint(`${summary}\n${diagnostic}`, commands)
	const detail = diagnostic.trim().slice(-MAX_DIAGNOSTIC_CHARS)
	return [`${label}: ${summary}`, hint, detail ? `Details:\n${detail}` : undefined].filter(Boolean).join("\n\n")
}
