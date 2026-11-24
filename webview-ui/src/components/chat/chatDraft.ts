import type { MentionSegment } from "@roo-code/types"
import { applyEdit, generatedSegments, joinSegments, trimSegments, userSegments } from "@roo/mentionSegments"

export function createChatDraft() {
	let text = ""
	// Null means all text in the draft came from the user.
	let segments: MentionSegment[] | null = null
	const listeners = new Set<() => void>()

	const replace = (nextText: string, nextSegments: MentionSegment[] | null) => {
		segments = nextSegments
		// Composer and follow-up subscribers only display the text.
		if (text === nextText) return

		text = nextText
		for (const listener of listeners) listener()
	}

	return {
		subscribe(listener: () => void) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		getText: () => text,
		hasText: () => text.trim().length > 0,
		getSegments: () => segments,
		segmentsFor(submittedText: string) {
			const trimmed = segments === null ? userSegments(submittedText) : trimSegments(segments)
			return joinSegments(trimmed) === submittedText ? trimmed : generatedSegments(submittedText)
		},
		replace,
		clear: () => replace("", null),
		edit: (nextText: string) => replace(nextText, segments === null ? null : applyEdit(segments, text, nextText)),
		replaceWithGenerated: (nextText: string) => replace(nextText, generatedSegments(nextText)),
		append(nextText: string, separator: string, nextSegments: MentionSegment[]) {
			if (text === "") {
				replace(nextText, nextSegments)
				return
			}
			replace(text + separator + nextText, [
				...(segments ?? userSegments(text)),
				...generatedSegments(separator),
				...nextSegments,
			])
		},
	}
}
