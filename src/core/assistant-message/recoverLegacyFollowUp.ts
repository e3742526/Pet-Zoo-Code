// These are the wrappers emitted by the old tool format. The data inside them is JSON.
const LEGACY_QUESTION_TAGS =
	/<\/?(?:question|invoke)(?:\s[^<>]*)?>|<\/parameter\s*>|<parameter\s+name\s*=\s*(?:"question"|'question')\s*>/g

export function recoverLegacyFollowUp(question: string): { question: string; followUp: unknown[] } | undefined {
	const tokens =
		/<follow_up\s*>|<parameter\s+name\s*=\s*(?:"follow_up"|'follow_up')\s*>|<\/(?:follow_up|parameter)\s*>|"|\\[\s\S]/g
	let wrapper: { start: number; payloadStart: number; closingTag: string } | undefined
	let inString = false
	let match: RegExpExecArray | null

	while ((match = tokens.exec(question)) !== null) {
		const [token] = match
		if (token === '"') {
			inString = wrapper !== undefined && !inString
			continue
		}
		// Escaped characters and tags inside JSON strings do not end a wrapper.
		if (inString || !token.startsWith("<")) {
			continue
		}
		if (!token.startsWith("</")) {
			wrapper = {
				start: match.index,
				payloadStart: tokens.lastIndex,
				closingTag: token.startsWith("<follow_up") ? "</follow_up" : "</parameter",
			}
			continue
		}
		if (!wrapper || !token.startsWith(wrapper.closingTag)) {
			continue
		}

		const { start, payloadStart } = wrapper
		wrapper = undefined
		let payload: unknown
		try {
			payload = JSON.parse(question.slice(payloadStart, match.index).trim())
		} catch {
			continue
		}
		if (Array.isArray(payload)) {
			return {
				question: (question.slice(0, start) + question.slice(tokens.lastIndex))
					.replace(LEGACY_QUESTION_TAGS, "")
					.trim(),
				followUp: payload,
			}
		}
	}
	return undefined
}
