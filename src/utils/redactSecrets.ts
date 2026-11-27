/** Well-known credential formats (GitHub, GitLab, npm, Stripe, OpenAI-style, AWS, Slack, Google). */
const KNOWN_TOKENS =
	/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[\w-]{20,}|npm_[A-Za-z0-9]{20,}|[rs]k_(?:live|test)_[A-Za-z0-9]{10,}|sk-[\w-]{10,}|A(?:KIA|SIA)[0-9A-Z]{16}|xox[baprs]-[\w-]{10,}|AIza[\w-]{20,})\b/g

/** Mask common credential formats before text leaves its original context. */
export function redactSecrets(text: string): string {
	return text
		.replace(
			/(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)[\s\S]*?(?=-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
			"$1\n[REDACTED]\n",
		)
		.replace(/(\b[a-z][\w+.-]*:\/\/)[^/@?#\s"'<>]+@/gi, "$1[REDACTED]@")
		.replace(/(\bauthorization["']?\s*[:=]\s*["']?\s*(?:bearer|basic)[ \t]+)[^\s"']+/gi, "$1[REDACTED]")
		.replace(
			/(\b[\w-]*(?:token|password|passwd|secret|api[_-]?key|client[_-]?secret|private[_-]?key|\b(?:pwd|pw|key))\b["']?[ \t]*[:=][ \t]*)(?:"(?:\\[^\r\n]|[^"\\\r\n])*"?|'(?:\\[^\r\n]|[^'\\\r\n])*'?|[^\s,;}]+)/gi,
			"$1[REDACTED]",
		)
		.replace(KNOWN_TOKENS, "[REDACTED]")
}
