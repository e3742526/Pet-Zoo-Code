import { useCallback, useLayoutEffect, useRef, useState } from "react"
import deepEqual from "fast-deep-equal"

type DraftSave<T> = { revision: number; host: T }

export function useSettingsDraft<T extends object>(host: T, fields?: readonly string[]) {
	const [draft, setDraft] = useState(host)
	const current = useRef(draft)
	const latestHost = useRef(host)
	const revision = useRef(0)
	const edits = useRef(new Map<keyof T, number>())

	const write = useCallback((value: T) => {
		current.current = value
		setDraft(value)
	}, [])

	useLayoutEffect(() => {
		const before = latestHost.current
		if (before === host) return
		latestHost.current = host

		let next: T | undefined
		const keys = fields ?? new Set([...Object.keys(before), ...Object.keys(host)])
		for (const key of keys as Iterable<keyof T>) {
			// Compare to the last host snapshot so the old host value cannot undo an optimistic save.
			if (
				edits.current.has(key) ||
				deepEqual(before[key], host[key]) ||
				deepEqual(current.current[key], host[key])
			) {
				continue
			}
			next ??= { ...current.current }
			next[key] = host[key]
		}
		if (next) write(next)
	}, [host, fields, write])

	const update = useCallback(
		<K extends keyof T>(key: K, change: (previous: T[K]) => T[K]) => {
			const previous = current.current
			const value = change(previous[key])
			if (Object.is(previous[key], value)) return
			edits.current.set(key, ++revision.current)
			write({ ...previous, [key]: value })
		},
		[write],
	)

	const captureSave = useCallback((): DraftSave<T> => ({ revision: revision.current, host: latestHost.current }), [])

	const markSaved = useCallback(
		(saved: DraftSave<T>) => {
			let next: T | undefined
			for (const [key, editedAt] of edits.current) {
				if (editedAt > saved.revision) continue
				edits.current.delete(key)
				const hostValue = latestHost.current[key]
				if (deepEqual(saved.host[key], hostValue) || deepEqual(current.current[key], hostValue)) continue
				next ??= { ...current.current }
				next[key] = hostValue
			}
			if (next) write(next)
			return revision.current === saved.revision
		},
		[write],
	)

	const reset = useCallback(() => {
		edits.current.clear()
		revision.current += 1
		write(latestHost.current)
	}, [write])

	return { draft, update, captureSave, markSaved, reset }
}
