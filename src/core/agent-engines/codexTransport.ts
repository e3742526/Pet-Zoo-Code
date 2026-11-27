import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import { z } from "zod"

import { closeNativeProcess, NativeDisconnectedError } from "./process"

const MAX_FRAME = 16 * 1024 * 1024
const idSchema = z.union([z.number().int(), z.string()])
const envelopeSchema = z.object({
	id: idSchema.optional(),
	method: z.string().optional(),
	params: z.unknown().optional(),
	result: z.unknown().optional(),
	error: z.unknown().optional(),
})

type Id = z.infer<typeof idSchema>
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }
type Receive = (method: string, params: unknown, id?: Id) => void

export class CodexTransport {
	private id = 0
	private pending = new Map<Id, Pending>()
	private buffer = ""
	private decoder = new StringDecoder("utf8")
	private failure?: Error
	private closing?: Promise<void>
	onMessage?: Receive
	onFailure?: (error: Error) => void

	constructor(private readonly child: ChildProcessWithoutNullStreams) {
		child.stdout.on("data", (chunk: Buffer) => this.accept(this.decoder.write(chunk)))
		child.stdout.on("end", () => {
			this.accept(this.decoder.end())
			if (this.buffer.trim()) this.fail(new Error("Codex returned an incomplete protocol message."))
		})
		child.stderr.resume()
		child.stdin.on("error", () => this.fail(new NativeDisconnectedError("The Codex input stream closed.")))
		child.on("error", () => this.fail(new Error("Codex could not start.")))
		child.on("close", () =>
			this.fail(new NativeDisconnectedError("The Codex process exited before reporting a result.")),
		)
	}

	private accept(chunk: string) {
		if (this.failure) return
		this.buffer += chunk
		while (true) {
			const newline = this.buffer.indexOf("\n")
			if (newline === -1) break
			const line = this.buffer.slice(0, newline).trim()
			this.buffer = this.buffer.slice(newline + 1)
			if (!line) continue
			try {
				if (line.length > MAX_FRAME) throw new Error()
				const { id, method, params, result, error } = envelopeSchema.parse(JSON.parse(line))
				if (method) {
					if (this.onMessage) this.onMessage(method, params, id)
					else if (id !== undefined) this.reject(id)
				} else if (id !== undefined) {
					const request = this.pending.get(id)
					this.pending.delete(id)
					if (error !== undefined)
						request?.reject(new Error("Codex rejected the request. Check its setup and session."))
					else if (result === undefined) throw new Error()
					else request?.resolve(result)
				} else {
					throw new Error()
				}
			} catch {
				this.fail(new Error("Codex returned an invalid protocol message."))
				return
			}
		}
		if (this.buffer.length > MAX_FRAME) this.fail(new Error("A Codex protocol message exceeded the size limit."))
	}

	private fail(error: Error) {
		if (this.failure) return
		this.failure = error
		for (const request of this.pending.values()) request.reject(error)
		this.pending.clear()
		this.onFailure?.(error)
	}

	private write(message: object) {
		if (this.failure) return
		if (this.child.stdin.writableLength > MAX_FRAME) {
			this.fail(new Error("The Codex input stream is blocked."))
			return
		}
		this.child.stdin.write(JSON.stringify(message) + "\n")
	}

	request(method: string, params: object, timeout = 10_000): Promise<unknown> {
		if (this.failure) return Promise.reject(this.failure)
		const id = ++this.id
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id)
				reject(new Error(`Codex did not respond to ${method}.`))
			}, timeout)
			this.pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer)
					resolve(value)
				},
				reject: (error) => {
					clearTimeout(timer)
					reject(error)
				},
			})
			this.write({ id, method, params })
		})
	}

	notify(method: string) {
		this.write({ method })
	}
	reply(id: Id, result: object) {
		this.write({ id, result })
	}
	reject(id: Id) {
		this.write({ id, error: { code: -32601, message: "Unsupported request" } })
	}

	close(): Promise<void> {
		if (!this.closing) {
			this.onFailure = undefined
			this.fail(new Error("The Codex connection closed."))
			this.closing = closeNativeProcess(this.child)
		}
		return this.closing
	}
}
