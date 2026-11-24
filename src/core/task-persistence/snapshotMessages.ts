import { types } from "node:util"

const USE_STRUCTURED_CLONE = Symbol("use structuredClone")

/**
 * Capture a detached transcript before the asynchronous writer runs.
 * Copy plain data directly so large immutable strings can share their storage.
 */
export function snapshotMessages<T>(messages: readonly T[]): T[] {
	try {
		return copyMessageData(messages, new Map()) as T[]
	} catch (error) {
		if (error !== USE_STRUCTURED_CLONE && !(error instanceof RangeError)) {
			throw error
		}
		return structuredClone(messages) as T[]
	}
}

function copyMessageData(value: unknown, copies: Map<object, object>): unknown {
	if (value === null || typeof value !== "object") {
		if (typeof value === "function" || typeof value === "symbol") {
			throw USE_STRUCTURED_CLONE
		}
		return value
	}

	const existingCopy = copies.get(value)
	if (existingCopy) {
		return existingCopy
	}
	if (types.isProxy(value)) {
		throw USE_STRUCTURED_CLONE
	}

	const prototype = Object.getPrototypeOf(value)
	const isArray = Array.isArray(value)
	if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
		throw USE_STRUCTURED_CLONE
	}

	const copy: object = isArray ? new Array<unknown>(value.length) : {}
	copies.set(value, copy)
	for (const key of Object.keys(value)) {
		const property = Object.getOwnPropertyDescriptor(value, key)
		// Let structuredClone handle accessors without calling a getter twice.
		if (!property || !("value" in property)) {
			throw USE_STRUCTURED_CLONE
		}
		const child = copyMessageData(property.value, copies)
		if (key === "__proto__") {
			Object.defineProperty(copy, key, { value: child, enumerable: true, writable: true, configurable: true })
		} else {
			Reflect.set(copy, key, child)
		}
	}
	return copy
}
