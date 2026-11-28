import EventEmitter from "node:events"
import { Socket } from "node:net"
import * as crypto from "node:crypto"

import ipc from "node-ipc"

import {
	type IpcServerEvents,
	type RooCodeIpcServer,
	IpcOrigin,
	IpcMessageType,
	type IpcMessage,
	ipcMessageSchema,
} from "@roo-code/types"

export class IpcServer extends EventEmitter<IpcServerEvents> implements RooCodeIpcServer {
	private readonly _socketPath: string
	private readonly _log: (...args: unknown[]) => void
	private readonly _clients: Map<string, Socket>

	private _server?: typeof ipc.server
	private _serverStarted = false
	private _isListening = false

	constructor(socketPath: string, log = console.log) {
		super()

		this._socketPath = socketPath
		this._log = log
		this._clients = new Map()
	}

	public listen() {
		this._isListening = true
		if (this._server) {
			return
		}

		ipc.config.silent = true
		ipc.serve(this.socketPath)
		const server = (this._server = ipc.server)

		server.on("start", () => {
			this._serverStarted = true
			if (!this._isListening) {
				this.stopServer()
				return
			}

			server.on("connect", (socket) => this.onConnect(socket))
			server.on("socket.disconnected", (socket) => this.onDisconnect(socket))
			server.on("message", (data) => this.onMessage(data))
		})
		server.on("error", () => {
			if (!this._serverStarted && this._server === server) {
				this._server = undefined
				this._isListening = false
			}
		})

		server.start()
	}

	private onConnect(socket: Socket) {
		const clientId = crypto.randomBytes(6).toString("hex")
		this._clients.set(clientId, socket)
		this.log(`[server#onConnect] clientId = ${clientId}, # clients = ${this._clients.size}`)

		this.send(socket, {
			type: IpcMessageType.Ack,
			origin: IpcOrigin.Server,
			data: { clientId, pid: process.pid, ppid: process.ppid },
		})

		this.emit(IpcMessageType.Connect, clientId)
	}

	private onDisconnect(destroyedSocket: Socket) {
		let disconnectedClientId: string | undefined

		for (const [clientId, socket] of this._clients.entries()) {
			if (socket === destroyedSocket) {
				disconnectedClientId = clientId
				this._clients.delete(clientId)
				break
			}
		}

		this.log(`[server#socket.disconnected] clientId = ${disconnectedClientId}, # clients = ${this._clients.size}`)

		if (disconnectedClientId) {
			this.emit(IpcMessageType.Disconnect, disconnectedClientId)
		}
	}

	private onMessage(data: unknown) {
		if (typeof data !== "object") {
			this.log("[server#onMessage] invalid data")
			return
		}

		const result = ipcMessageSchema.safeParse(data)

		if (!result.success) {
			// Both the input and Zod issue values/paths may contain credentials.
			this.log("[server#onMessage] invalid payload", { issueCount: result.error.issues.length })

			return
		}

		const payload = result.data

		if (payload.origin === IpcOrigin.Client) {
			switch (payload.type) {
				case IpcMessageType.TaskCommand:
					this.emit(IpcMessageType.TaskCommand, payload.clientId, payload.data)
					break
				default:
					this.log("[server#onMessage] unhandled payload")
					break
			}
		}
	}

	private log(...args: unknown[]) {
		this._log(...args)
	}

	public broadcast(message: IpcMessage) {
		// this.log("[server#broadcast] message =", message)
		this._server?.broadcast("message", message)
	}

	public send(client: string | Socket, message: IpcMessage) {
		// this.log("[server#send] message =", message)

		if (typeof client === "string") {
			const socket = this._clients.get(client)

			if (socket) {
				this._server?.emit(socket, "message", message)
			}
		} else {
			this._server?.emit(client, "message", message)
		}
	}

	/** Stops the server and drops its clients, including when shutdown races with startup. */
	public close() {
		this._isListening = false
		this.stopServer()
	}

	private stopServer() {
		// node-ipc creates its socket server asynchronously. The start handler stops it if close came first.
		if (!this._server || !this._serverStarted) {
			return
		}

		this._server.stop()
		this._server = undefined
		this._serverStarted = false
		// Stopping the listener still leaves established connections open.
		for (const socket of this._clients.values()) {
			socket.destroy()
		}
		this._clients.clear()
	}

	public get socketPath() {
		return this._socketPath
	}

	public get isListening() {
		return this._isListening
	}
}
