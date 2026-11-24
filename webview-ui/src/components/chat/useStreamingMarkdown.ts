import { useEffect, useLayoutEffect, useRef, useState } from "react"

const LONG_MARKDOWN_LENGTH = 8 * 1024
const STREAMING_MARKDOWN_INTERVAL_MS = 240

/** Bounds Markdown rendering work for long partial messages. */
export function useStreamingMarkdown(markdown: string | undefined, partial?: boolean): string | undefined {
	const coalesce = partial === true && markdown !== undefined && markdown.length >= LONG_MARKDOWN_LENGTH
	const [preview, setPreview] = useState(() => (coalesce ? markdown : undefined))
	const publishedAt = useRef(0)

	// Start a new window with the current text when a stream reaches the size threshold.
	if (coalesce !== (preview !== undefined)) {
		setPreview(coalesce ? markdown : undefined)
	}

	useLayoutEffect(() => {
		if (preview !== undefined) {
			publishedAt.current = performance.now()
		}
	}, [preview])

	useEffect(() => {
		if (!coalesce || preview === markdown) return

		// Use the last published time so subsequent chunks do not push the deadline back.
		const delay = Math.max(0, STREAMING_MARKDOWN_INTERVAL_MS - (performance.now() - publishedAt.current))
		const timer = setTimeout(() => setPreview(markdown), delay)
		return () => clearTimeout(timer)
	}, [coalesce, markdown, preview])

	return coalesce ? (preview ?? markdown) : markdown
}
