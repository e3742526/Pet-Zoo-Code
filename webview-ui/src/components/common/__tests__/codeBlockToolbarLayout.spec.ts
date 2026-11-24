import { subscribeToToolbarLayout } from "../codeBlockToolbarLayout"

describe("code block toolbar layout", () => {
	it("shares a frame and completes measurements before updating the toolbars", () => {
		const scroller = document.createElement("div")
		const viewport = new DOMRect(0, 0, 800, 600)
		const readViewport = vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(viewport)
		let flush: FrameRequestCallback | undefined
		const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			flush = callback
			return 1
		})
		const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})
		const order: string[] = []
		const measure = (toolbar: string) => (bounds: DOMRect) => {
			expect(bounds).toBe(viewport)
			order.push(`read ${toolbar}`)
			return () => order.push(`write ${toolbar}`)
		}
		const removeFirst = subscribeToToolbarLayout(scroller, measure("first"))
		const removeSecond = subscribeToToolbarLayout(scroller, measure("second"))
		try {
			scroller.dispatchEvent(new Event("scroll"))
			scroller.dispatchEvent(new Event("scroll"))
			window.dispatchEvent(new Event("resize"))
			expect(requestFrame).toHaveBeenCalledTimes(1)
			expect(order).toEqual([])

			flush?.(0)
			expect(readViewport).toHaveBeenCalledTimes(1)
			expect(order).toEqual(["read first", "read second", "write first", "write second"])

			removeFirst()
			scroller.dispatchEvent(new Event("scroll"))
			expect(requestFrame).toHaveBeenCalledTimes(2)
			removeSecond()
			expect(cancelFrame).toHaveBeenCalledWith(1)
			scroller.dispatchEvent(new Event("scroll"))
			expect(requestFrame).toHaveBeenCalledTimes(2)
		} finally {
			removeFirst()
			removeSecond()
			requestFrame.mockRestore()
			cancelFrame.mockRestore()
		}
	})
})
