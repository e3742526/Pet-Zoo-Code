import { memo, useEffect, useMemo, useRef, useCallback, useState, useSyncExternalStore } from "react"
import styled from "styled-components"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { getHighlighter, isLanguageLoaded, normalizeLanguage } from "@src/utils/highlighter"
import type { BundledTheme, Highlighter, ShikiTransformer } from "shiki"
import { toJsxRuntime } from "hast-util-to-jsx-runtime"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import { ChevronDown, ChevronUp, Copy, Check } from "lucide-react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { StandardTooltip } from "@/components/ui"
import { subscribeToToolbarLayout } from "./codeBlockToolbarLayout"

export const CODE_BLOCK_BG_COLOR =
	"var(--vscode-textCodeBlock-background, var(--vscode-editor-background, var(--vscode-sideBar-background, rgb(30 30 30))))"
export const CODE_BLOCK_TOOLBAR_BG_COLOR =
	"color-mix(in srgb, var(--vscode-editor-background, var(--vscode-sideBar-background, rgb(30 30 30))) 90%, transparent)"

export function getCodeBlockTheme(bodyClass: string): BundledTheme {
	if (bodyClass.toLowerCase().includes("high-contrast-light")) return "github-light-high-contrast"
	if (bodyClass.toLowerCase().includes("high-contrast")) return "github-dark-high-contrast"
	return bodyClass.toLowerCase().includes("light") ? "github-light-high-contrast" : "github-dark-high-contrast"
}

const themeListeners = new Set<() => void>()
let themeObserver: MutationObserver | undefined

function subscribeToCodeBlockTheme(listener: () => void) {
	themeListeners.add(listener)
	if (!themeObserver) {
		themeObserver = new MutationObserver(() => {
			for (const notify of themeListeners) notify()
		})
		const options = {
			attributes: true,
			attributeFilter: ["class", "data-vscode-theme-id", "data-vscode-theme-kind"],
		}
		themeObserver.observe(document.documentElement, options)
		themeObserver.observe(document.body, options)
	}
	return () => {
		themeListeners.delete(listener)
		if (themeListeners.size === 0) {
			themeObserver?.disconnect()
			themeObserver = undefined
		}
	}
}

const readCodeBlockTheme = () => getCodeBlockTheme(document.body.className)

const LONG_CODE_LENGTH = 4 * 1024
const STREAMING_HIGHLIGHT_QUIET_MS = 320

// Configuration constants
export const WINDOW_SHADE_SETTINGS = {
	transitionDelayS: 0.2,
	collapsedHeight: 500, // Default collapsed height in pixels
}

// Tolerance in pixels for determining when a container is considered "at the bottom"
export const SCROLL_SNAP_TOLERANCE = 20

/*
overflowX: auto + inner div with padding results in an issue where the top/left/bottom padding renders but the right padding inside does not count as overflow as the width of the element is not exceeded. Once the inner div is outside the boundaries of the parent it counts as overflow.
https://stackoverflow.com/questions/60778406/why-is-padding-right-clipped-with-overflowscroll/77292459#77292459
this fixes the issue of right padding clipped off 
“ideal” size in a given axis when given infinite available space--allows the syntax highlighter to grow to largest possible width including its padding
minWidth: "max-content",
*/

interface CodeBlockProps {
	source?: string
	rawSource?: string // Add rawSource prop for copying raw text
	language: string
	partial?: boolean
	preStyle?: React.CSSProperties
	initialWordWrap?: boolean
	collapsedHeight?: number
	initialWindowShade?: boolean
}

const CodeBlockButton = styled.button`
	background: transparent;
	border: none;
	color: var(--vscode-icon-foreground, var(--vscode-foreground));
	cursor: var(--copy-button-cursor, default);
	padding: 4px;
	margin: 0 0px;
	display: flex;
	align-items: center;
	justify-content: center;
	opacity: 1;
	border-radius: 3px;
	pointer-events: var(--copy-button-events, none);
	margin-left: 4px;
	height: 24px;
	width: 24px;

	&:hover {
		background: var(--vscode-toolbar-hoverBackground);
		opacity: 1;
	}

	/* Style for Lucide icons to ensure consistent sizing and positioning */
	svg {
		display: block;
	}
`

const CodeBlockButtonWrapper = styled.div`
	position: fixed;
	top: var(--copy-button-top);
	right: var(--copy-button-right, 8px);
	height: auto;
	z-index: 40;
	background: ${CODE_BLOCK_TOOLBAR_BG_COLOR};
	overflow: visible;
	pointer-events: none;
	opacity: var(--copy-button-opacity, 0);
	padding: 4px 6px;
	border-radius: 3px;
	display: inline-flex;
	align-items: center;
	justify-content: center;

	&:hover {
		background: var(--vscode-editor-background);
		opacity: 1 !important;
	}

	${CodeBlockButton} {
		position: relative;
		top: 0;
		right: 0;
	}
`

const CodeBlockContainer = styled.div`
	position: relative;
	overflow: hidden;
	background-color: ${CODE_BLOCK_BG_COLOR};

	${CodeBlockButtonWrapper} {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s; /* Keep opacity transition for buttons */
	}

	&[data-partially-visible="true"]:hover ${CodeBlockButtonWrapper} {
		opacity: 1;
		pointer-events: all;
		cursor: pointer;
	}
`

export const StyledPre = styled.div<{
	preStyle?: React.CSSProperties
	wordwrap?: "true" | "false" | undefined
	windowshade?: "true" | "false"
	collapsedHeight?: number
}>`
	background-color: ${CODE_BLOCK_BG_COLOR};
	max-height: ${({ windowshade, collapsedHeight }) =>
		windowshade === "true" ? `${collapsedHeight || WINDOW_SHADE_SETTINGS.collapsedHeight}px` : "none"};
	overflow-y: auto;
	padding: 8px 3px;
	border-radius: 6px;
	${({ preStyle }) => preStyle && { ...preStyle }}

	pre {
		background-color: ${CODE_BLOCK_BG_COLOR};
		border-radius: 5px;
		margin: 0;
		padding: 10px;
		width: 100%;
		box-sizing: border-box;
	}

	pre,
	code {
		/* Undefined wordwrap defaults to true (pre-wrap) behavior. */
		white-space: ${({ wordwrap }) => (wordwrap === "false" ? "pre" : "pre-wrap")};
		word-break: ${({ wordwrap }) => (wordwrap === "false" ? "normal" : "normal")};
		overflow-wrap: ${({ wordwrap }) => (wordwrap === "false" ? "normal" : "break-word")};
		font-size: 0.95em;
		font-family: var(--vscode-editor-font-family);
	}

	pre > code {
		.hljs-deletion {
			background-color: var(--vscode-diffEditor-removedTextBackground);
			display: inline-block;
			width: 100%;
		}
		.hljs-addition {
			background-color: var(--vscode-diffEditor-insertedTextBackground);
			display: inline-block;
			width: 100%;
		}
	}

	.hljs {
		color: var(--vscode-editor-foreground, #fff);
		background-color: ${CODE_BLOCK_BG_COLOR};
	}
`

const CodeBlock = memo(
	({
		source,
		rawSource,
		language,
		partial = false,
		preStyle,
		initialWordWrap = true,
		initialWindowShade = true,
		collapsedHeight,
	}: CodeBlockProps) => {
		// Use word wrap from props, default to true
		const wordWrap = initialWordWrap
		const [windowShade, setWindowShade] = useState(initialWindowShade)
		const currentLanguage = normalizeLanguage(language)
		const codeText = source ?? ""
		const longCode = codeText.length >= LONG_CODE_LENGTH
		const deferHighlight = partial && longCode
		const [highlight, setHighlight] = useState<{ text: string; language: string; element: React.ReactNode }>()
		const fallback = useMemo(
			() => (
				<pre style={{ padding: 0, margin: 0 }}>
					<code className={`hljs language-${currentLanguage}`}>{codeText}</code>
				</pre>
			),
			[codeText, currentLanguage],
		)
		const displayedCode =
			longCode && (highlight?.text !== codeText || highlight?.language !== currentLanguage)
				? fallback
				: highlight?.element
		const [showCollapseButton, setShowCollapseButton] = useState(true)
		const codeTheme = useSyncExternalStore(subscribeToCodeBlockTheme, readCodeBlockTheme)
		const codeBlockRef = useRef<HTMLDivElement>(null)
		const preRef = useRef<HTMLDivElement>(null)
		const copyButtonWrapperRef = useRef<HTMLDivElement>(null)
		const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard()
		const { t } = useAppTranslation()
		const buttonPositionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
		const collapseTimeout1Ref = useRef<NodeJS.Timeout | null>(null)
		const collapseTimeout2Ref = useRef<NodeJS.Timeout | null>(null)

		// Each run owns its result until the source, language, or theme changes.
		useEffect(() => {
			let cancelled = false
			let timer: ReturnType<typeof setTimeout> | undefined

			const publish = (element: React.ReactNode) =>
				setHighlight({ text: codeText, language: currentLanguage, element })
			const handleError = (error: unknown) => {
				if (cancelled) return
				console.error(
					"[CodeBlock] Syntax highlighting error:",
					error,
					"\nStack trace:",
					error instanceof Error ? error.stack : undefined,
				)
				publish(fallback)
			}

			const highlightCode = (highlighter: Highlighter) => {
				const hast = highlighter.codeToHast(codeText, {
					lang: currentLanguage,
					theme: codeTheme,
					transformers: [
						{
							pre(node) {
								node.properties.style = `padding: 0; margin: 0; background-color: ${CODE_BLOCK_BG_COLOR}; background-image: none;`
								return node
							},
							code(node) {
								// Add hljs classes for consistent styling
								node.properties.class = `hljs language-${currentLanguage}`
								node.properties.style = "background-color: transparent; background-image: none;"
								return node
							},
							line(node) {
								// Preserve existing line handling
								node.properties.class = node.properties.class || ""
								return node
							},
						},
					] as ShikiTransformer[],
				})

				publish(toJsxRuntime(hast, { Fragment, jsx, jsxs }))
			}

			if (!longCode && !isLanguageLoaded(currentLanguage)) publish(fallback)
			const highlightAt = deferHighlight ? performance.now() + STREAMING_HIGHLIGHT_QUIET_MS : 0
			// Start loading the grammar while text is still arriving.
			void getHighlighter(currentLanguage)
				.then((highlighter) => {
					if (cancelled) return
					const delay = deferHighlight ? highlightAt - performance.now() : 0
					if (delay <= 0) {
						highlightCode(highlighter)
						return
					}
					timer = setTimeout(() => {
						try {
							highlightCode(highlighter)
						} catch (error) {
							handleError(error)
						}
					}, delay)
				})
				.catch(handleError)

			return () => {
				cancelled = true
				clearTimeout(timer)
				if (buttonPositionTimeoutRef.current) {
					clearTimeout(buttonPositionTimeoutRef.current)
					buttonPositionTimeoutRef.current = null
				}
				if (collapseTimeout1Ref.current) {
					clearTimeout(collapseTimeout1Ref.current)
					collapseTimeout1Ref.current = null
				}
				if (collapseTimeout2Ref.current) {
					clearTimeout(collapseTimeout2Ref.current)
					collapseTimeout2Ref.current = null
				}
			}
		}, [codeText, currentLanguage, collapsedHeight, codeTheme, deferHighlight, fallback, longCode])

		// Check if content height exceeds collapsed height whenever content changes
		useEffect(() => {
			const codeBlock = codeBlockRef.current

			if (codeBlock) {
				const actualHeight = codeBlock.scrollHeight
				setShowCollapseButton(actualHeight >= (collapsedHeight || WINDOW_SHADE_SETTINGS.collapsedHeight))
			}
		}, [displayedCode, collapsedHeight])

		// Ref to track if user was scrolled up *before* the source update
		// potentially changes scrollHeight
		const wasScrolledUpRef = useRef(false)

		// Effect to listen to scroll events and update the ref
		useEffect(() => {
			const preElement = preRef.current
			if (!preElement) return

			const handleScroll = () => {
				const isAtBottom =
					Math.abs(preElement.scrollHeight - preElement.scrollTop - preElement.clientHeight) <
					SCROLL_SNAP_TOLERANCE
				wasScrolledUpRef.current = !isAtBottom
			}

			preElement.addEventListener("scroll", handleScroll, { passive: true })
			// Initial check in case it starts scrolled up
			handleScroll()

			return () => {
				preElement.removeEventListener("scroll", handleScroll)
			}
		}, []) // Empty dependency array: runs once on mount

		// Store whether we should scroll after highlighting completes
		const shouldScrollAfterHighlightRef = useRef(false)
		const previousSourceRef = useRef(source)

		// Check if we should scroll when source changes
		useEffect(() => {
			const sourceChanged = previousSourceRef.current !== source
			// Follow streaming updates when the user was already at the bottom, but keep initial content at the top.
			if (sourceChanged && preRef.current && source && !wasScrolledUpRef.current) {
				shouldScrollAfterHighlightRef.current = true
			} else {
				shouldScrollAfterHighlightRef.current = false
			}
			previousSourceRef.current = source
		}, [source])

		const measureToolbarLayout = useCallback((scrollRect: DOMRect, forceHide = false) => {
			const codeBlock = codeBlockRef.current
			const copyWrapper = copyButtonWrapperRef.current

			if (!codeBlock) {
				return
			}

			const rectCodeBlock = codeBlock.getBoundingClientRect()

			// Get wrapper height dynamically
			let wrapperHeight

			if (copyWrapper) {
				const copyRect = copyWrapper.getBoundingClientRect()

				// If height is 0 due to styling, estimate from children
				if (copyRect.height > 0) {
					wrapperHeight = copyRect.height
				} else if (copyWrapper.children.length > 0) {
					// Try to get height from the button inside
					const buttonRect = copyWrapper.children[0].getBoundingClientRect()
					const buttonStyle = window.getComputedStyle(copyWrapper.children[0] as Element)
					const buttonPadding =
						parseInt(buttonStyle.getPropertyValue("padding-top") || "0", 10) +
						parseInt(buttonStyle.getPropertyValue("padding-bottom") || "0", 10)
					wrapperHeight = buttonRect.height + buttonPadding
				}
			}

			// If we still don't have a height, calculate from font size
			if (!wrapperHeight) {
				const fontSize = parseInt(window.getComputedStyle(document.body).getPropertyValue("font-size"), 10)
				wrapperHeight = fontSize * 2.5 // Approximate button height based on font size
			}

			const copyButtonEdge = 48
			const isPartiallyVisible =
				rectCodeBlock.top < scrollRect.bottom - copyButtonEdge &&
				rectCodeBlock.bottom >= scrollRect.top + copyButtonEdge

			// Calculate margin from existing padding in the component
			const computedStyle = window.getComputedStyle(codeBlock)
			const paddingValue = parseInt(computedStyle.getPropertyValue("padding") || "0", 10)
			const margin =
				paddingValue > 0 ? paddingValue : parseInt(computedStyle.getPropertyValue("padding-top") || "0", 10)

			// Update visibility state and button interactivity
			const isVisible = !forceHide && isPartiallyVisible
			return () => {
				codeBlock.setAttribute("data-partially-visible", isPartiallyVisible ? "true" : "false")
				codeBlock.style.setProperty("--copy-button-cursor", isVisible ? "pointer" : "default")
				codeBlock.style.setProperty("--copy-button-events", isVisible ? "all" : "none")
				codeBlock.style.setProperty("--copy-button-opacity", isVisible ? "1" : "0")

				if (isPartiallyVisible) {
					// Keep the button inside the measured code block and viewport.
					const topPosition = Math.max(
						scrollRect.top + margin,
						Math.min(rectCodeBlock.bottom - wrapperHeight - margin, rectCodeBlock.top + margin),
					)
					const rightPosition = Math.max(margin, scrollRect.right - rectCodeBlock.right + margin)
					codeBlock.style.setProperty("--copy-button-top", `${topPosition}px`)
					codeBlock.style.setProperty("--copy-button-right", `${rightPosition}px`)
				}
			}
		}, [])

		const updateCodeBlockButtonPosition = useCallback(
			(forceHide = false) => {
				const scroller = document.querySelector('[data-virtuoso-scroller="true"]')
				if (scroller) measureToolbarLayout(scroller.getBoundingClientRect(), forceHide)?.()
			},
			[measureToolbarLayout],
		)

		useEffect(() => {
			const scroller = document.querySelector('[data-virtuoso-scroller="true"]')
			if (!scroller) return
			const unsubscribe = subscribeToToolbarLayout(scroller, measureToolbarLayout)
			measureToolbarLayout(scroller.getBoundingClientRect())?.()
			return unsubscribe
		}, [measureToolbarLayout])

		// Update button position and scroll when the displayed code changes.
		useEffect(() => {
			if (displayedCode) {
				// Clear any existing timeout before setting a new one
				if (buttonPositionTimeoutRef.current) {
					clearTimeout(buttonPositionTimeoutRef.current)
				}
				// Update button position
				buttonPositionTimeoutRef.current = setTimeout(() => {
					updateCodeBlockButtonPosition()
					buttonPositionTimeoutRef.current = null // Optional: Clear ref after execution
				}, 0)

				// Scroll to bottom if needed after the displayed code updates.
				if (shouldScrollAfterHighlightRef.current) {
					// Scroll inner container
					if (preRef.current) {
						preRef.current.scrollTop = preRef.current.scrollHeight
						wasScrolledUpRef.current = false
					}

					// Outer container scrolling is handled by Virtuoso's followOutput
					// and ChatView's handleRowHeightChange — no direct DOM manipulation needed.

					// Reset the flag
					shouldScrollAfterHighlightRef.current = false
				}
			}
			// Cleanup function for this effect
			return () => {
				if (buttonPositionTimeoutRef.current) {
					clearTimeout(buttonPositionTimeoutRef.current)
				}
			}
		}, [displayedCode, updateCodeBlockButtonPosition])

		// Advanced inertial scroll chaining
		// This effect handles the transition between scrolling the code block and the outer container.
		// When a user scrolls to the boundary of a code block (top or bottom), this implementation:
		// 1. Detects the boundary condition
		// 2. Applies inertial scrolling to the outer container for a smooth transition
		// 3. Adds physics-based momentum for natural deceleration
		// This creates a seamless experience where scrolling flows naturally between nested scrollable areas
		useEffect(() => {
			if (!preRef.current) return

			// Find the outer scrollable container
			const getScrollContainer = () => {
				return document.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement
			}

			// Inertial scrolling implementation
			let velocity = 0
			let animationFrameId: number | null = null
			const FRICTION = 0.85 // Friction coefficient (lower = more friction)
			const MIN_VELOCITY = 0.5 // Minimum velocity before stopping

			// Animation function for inertial scrolling
			const animate = () => {
				const scrollContainer = getScrollContainer()
				if (!scrollContainer) return

				// Apply current velocity
				if (Math.abs(velocity) > MIN_VELOCITY) {
					scrollContainer.scrollBy(0, velocity)
					velocity *= FRICTION // Apply friction
					animationFrameId = requestAnimationFrame(animate)
				} else {
					velocity = 0
					animationFrameId = null
				}
			}

			// Wheel event handler with inertial scrolling
			const handleWheel = (e: WheelEvent) => {
				// If shift is pressed, let the browser handle default horizontal scrolling
				if (e.shiftKey) {
					return
				}
				if (!preRef.current) return

				// Only handle wheel events if the inner container has a scrollbar,
				// otherwise let the browser handle the default scrolling
				const hasScrollbar = preRef.current.scrollHeight > preRef.current.clientHeight

				// Pass through events if we don't need special handling
				if (!hasScrollbar) {
					return
				}

				const scrollContainer = getScrollContainer()
				if (!scrollContainer) return

				// Check if we're at the top or bottom of the inner container
				const isAtVeryTop = preRef.current.scrollTop === 0
				const isAtVeryBottom =
					Math.abs(preRef.current.scrollHeight - preRef.current.scrollTop - preRef.current.clientHeight) < 1

				// Handle scrolling at container boundaries
				if ((e.deltaY < 0 && isAtVeryTop) || (e.deltaY > 0 && isAtVeryBottom)) {
					// Prevent default to stop inner container from handling
					e.preventDefault()

					const boost = 0.15
					velocity += e.deltaY * boost

					// Start animation if not already running
					if (!animationFrameId) {
						animationFrameId = requestAnimationFrame(animate)
					}
				}
			}

			// Add wheel event listener to inner container
			const preElement = preRef.current
			preElement.addEventListener("wheel", handleWheel, { passive: false })

			// Clean up
			return () => {
				preElement.removeEventListener("wheel", handleWheel)

				// Cancel any ongoing animation
				if (animationFrameId) {
					cancelAnimationFrame(animationFrameId)
				}
			}
		}, [])

		// Track text selection state
		const [isSelecting, setIsSelecting] = useState(false)

		useEffect(() => {
			if (!preRef.current) return

			const handleMouseUp = () => {
				setIsSelecting(false)
			}
			const handleMouseDown = (e: MouseEvent) => {
				// Only trigger if clicking the pre element directly
				if (e.currentTarget === preRef.current) {
					setIsSelecting(true)
					document.addEventListener("mouseup", handleMouseUp, { once: true })
				}
			}

			const preElement = preRef.current
			preElement.addEventListener("mousedown", handleMouseDown)

			return () => {
				preElement.removeEventListener("mousedown", handleMouseDown)
				document.removeEventListener("mouseup", handleMouseUp)
			}
		}, [])

		const handleCopy = useCallback(
			(e: React.MouseEvent) => {
				e.stopPropagation()

				// Check if code block is partially visible before allowing copy
				const codeBlock = codeBlockRef.current
				if (!codeBlock || codeBlock.getAttribute("data-partially-visible") !== "true") {
					return
				}
				const textToCopy = rawSource !== undefined ? rawSource : source || ""
				if (textToCopy) {
					copyWithFeedback(textToCopy, e)
				}
			},
			[source, rawSource, copyWithFeedback],
		)

		if (source?.length === 0) {
			return null
		}

		return (
			<CodeBlockContainer ref={codeBlockRef}>
				<MemoizedStyledPre
					preRef={preRef}
					preStyle={preStyle}
					wordWrap={wordWrap}
					windowShade={windowShade}
					collapsedHeight={collapsedHeight}
					highlightedCode={displayedCode}
					updateCodeBlockButtonPosition={updateCodeBlockButtonPosition}
				/>
				{!isSelecting && (
					<CodeBlockButtonWrapper
						ref={copyButtonWrapperRef}
						onMouseOver={() => updateCodeBlockButtonPosition()}
						style={{ gap: 0 }}>
						{showCollapseButton && (
							<StandardTooltip
								content={t(`chat:codeblock.tooltips.${windowShade ? "expand" : "collapse"}`)}
								side="top">
								<CodeBlockButton
									aria-label={t(`chat:codeblock.tooltips.${windowShade ? "expand" : "collapse"}`)}
									onClick={() => {
										// Get the current code block element
										const codeBlock = codeBlockRef.current // Capture ref early
										// Toggle window shade state
										setWindowShade(!windowShade)

										// Clear any previous timeouts
										if (collapseTimeout1Ref.current) clearTimeout(collapseTimeout1Ref.current)
										if (collapseTimeout2Ref.current) clearTimeout(collapseTimeout2Ref.current)

										// After UI updates, ensure code block is visible and update button position
										collapseTimeout1Ref.current = setTimeout(
											() => {
												if (codeBlock) {
													// Check if codeBlock element still exists
													codeBlock.scrollIntoView({ behavior: "smooth", block: "nearest" })

													// Wait for scroll to complete before updating button position
													collapseTimeout2Ref.current = setTimeout(() => {
														// updateCodeBlockButtonPosition itself should also check for refs if needed
														updateCodeBlockButtonPosition()
														collapseTimeout2Ref.current = null
													}, 50)
												}
												collapseTimeout1Ref.current = null
											},
											WINDOW_SHADE_SETTINGS.transitionDelayS * 1000 + 50,
										)
									}}>
									{windowShade ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
								</CodeBlockButton>
							</StandardTooltip>
						)}
						<StandardTooltip content={t("chat:codeblock.tooltips.copy_code")} side="top">
							<CodeBlockButton aria-label={t("chat:codeblock.tooltips.copy_code")} onClick={handleCopy}>
								{showCopyFeedback ? <Check size={16} /> : <Copy size={16} />}
							</CodeBlockButton>
						</StandardTooltip>
					</CodeBlockButtonWrapper>
				)}
			</CodeBlockContainer>
		)
	},
)

// Memoized content component to prevent unnecessary re-renders of highlighted code
const MemoizedCodeContent = memo(({ children }: { children: React.ReactNode }) => <>{children}</>)

// Memoized StyledPre component
const MemoizedStyledPre = memo(
	({
		preRef,
		preStyle,
		wordWrap,
		windowShade,
		collapsedHeight,
		highlightedCode,
		updateCodeBlockButtonPosition,
	}: {
		preRef: React.RefObject<HTMLDivElement>
		preStyle?: React.CSSProperties
		wordWrap: boolean
		windowShade: boolean
		collapsedHeight?: number
		highlightedCode: React.ReactNode
		updateCodeBlockButtonPosition: (forceHide?: boolean) => void
	}) => (
		<StyledPre
			ref={preRef}
			preStyle={preStyle}
			wordwrap={wordWrap ? "true" : "false"}
			windowshade={windowShade ? "true" : "false"}
			collapsedHeight={collapsedHeight}
			onMouseDown={() => updateCodeBlockButtonPosition(true)}
			onMouseUp={() => updateCodeBlockButtonPosition(false)}>
			<MemoizedCodeContent>{highlightedCode}</MemoizedCodeContent>
		</StyledPre>
	),
)

export default CodeBlock
