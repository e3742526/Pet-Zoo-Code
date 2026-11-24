type ReadToolbarLayout = (viewport: DOMRect) => (() => void) | undefined
type ScrollSubscription = { layouts: Set<ReadToolbarLayout>; dispose: () => void }

const scrollListeners = new Map<Element, ScrollSubscription>()
const pendingScrollers = new Set<Element>()
let frame: number | undefined

function flushToolbarLayouts() {
	frame = undefined
	const writes: Array<() => void> = []
	for (const scroller of pendingScrollers) {
		const layouts = scrollListeners.get(scroller)?.layouts
		if (!layouts) continue
		const viewport = scroller.getBoundingClientRect()
		for (const read of layouts) {
			const write = read(viewport)
			if (write) writes.push(write)
		}
	}
	pendingScrollers.clear()
	// Finish layout reads before toolbar style changes can invalidate the measurements.
	for (const write of writes) write()
}

export function subscribeToToolbarLayout(scroller: Element, read: ReadToolbarLayout) {
	let subscription = scrollListeners.get(scroller)
	if (!subscription) {
		const schedule = () => {
			pendingScrollers.add(scroller)
			frame ??= requestAnimationFrame(flushToolbarLayouts)
		}
		scroller.addEventListener("scroll", schedule, { passive: true })
		window.addEventListener("resize", schedule)
		const layouts = new Set<ReadToolbarLayout>()
		subscription = {
			layouts,
			dispose: () => {
				scroller.removeEventListener("scroll", schedule)
				window.removeEventListener("resize", schedule)
			},
		}
		scrollListeners.set(scroller, subscription)
	}
	const { layouts, dispose } = subscription
	layouts.add(read)
	return () => {
		if (!layouts.delete(read) || layouts.size > 0) return
		dispose()
		scrollListeners.delete(scroller)
		pendingScrollers.delete(scroller)
		if (pendingScrollers.size === 0 && frame !== undefined) {
			cancelAnimationFrame(frame)
			frame = undefined
		}
	}
}
