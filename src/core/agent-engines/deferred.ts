export function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason: Error) => void
	const promise = new Promise<T>((fulfill, fail) => {
		resolve = fulfill
		reject = fail
	})
	return { promise, resolve, reject }
}
