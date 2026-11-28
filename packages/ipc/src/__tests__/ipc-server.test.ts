import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createConnection } from "node:net"
import { describe, it, type TestContext } from "node:test"
import os from "node:os"
import path from "node:path"
import ipc from "node-ipc"
import { IpcMessageType, IpcOrigin, TaskCommandName, ipcMessageSchema } from "@roo-code/types"
import { IpcServer } from "../ipc-server.js"

function fixture() {
	const logs: unknown[][] = []
	const commands: unknown[] = []
	const server = new IpcServer("/unused-test.sock", (...args) => logs.push(args))
	server.on(IpcMessageType.TaskCommand, (clientId, command) => commands.push({ clientId, command }))
	return { logs, commands, receive: (data: unknown) => server["onMessage"](data) }
}
const key = "dummy-api-key-not-for-public-logging"
const command = (requestId: string) => ({
	type: IpcMessageType.TaskCommand,
	origin: IpcOrigin.Client,
	clientId: "client-1",
	data: {
		commandName: TaskCommandName.StartNewTask,
		data: { requestId, text: "private prompt", configuration: { apiProvider: "openai", openAiApiKey: key } },
	},
})

describe("IPC rejection logging", () => {
	it("rejects an invalid request ID without logging its key, prompt or schema issue values", () => {
		const f = fixture()
		f.receive(command(`invalid request containing ${key}`))
		assert.deepEqual(f.commands, [])
		assert.equal(f.logs.length, 1)
		assert.equal(f.logs[0]?.[0], "[server#onMessage] invalid payload")
		assert.ok(!JSON.stringify(f.logs).includes(key))
		assert.ok(!JSON.stringify(f.logs).includes("private prompt"))
		assert.ok(!JSON.stringify(f.logs).includes("invalid request containing"))
	})
	it("does not log credential-shaped primitive input or dynamic issue paths", () => {
		const f = fixture()
		const valid = command("valid-id")
		const malformedHeaders = {
			...valid,
			data: {
				...valid.data,
				data: {
					...valid.data.data,
					configuration: { ...valid.data.data.configuration, openAiHeaders: { [key]: null } },
				},
			},
		}
		const rejected = ipcMessageSchema.safeParse(malformedHeaders)
		assert.ok(!rejected.success)
		assert.ok(rejected.error.issues.some((issue) => issue.path.includes(key)))
		for (const data of [key, null, { type: key }, malformedHeaders]) {
			f.receive(data)
		}
		assert.equal(f.logs.length, 4)
		assert.ok(!JSON.stringify(f.logs).includes(key))
		assert.deepEqual(f.commands, [])
	})
	it("still dispatches a valid correlated command to its client without logging its settings", () => {
		const f = fixture()
		f.receive(command("valid-id"))
		assert.equal(f.commands.length, 1)
		assert.deepEqual(f.commands[0], { clientId: "client-1", command: command("valid-id").data })
		assert.deepEqual(f.logs, [])
	})
})

describe("IpcServer.close", () => {
	function startServer(t: TestContext) {
		const name = `ipc-${randomUUID().slice(0, 8)}.sock`
		const socketPath = process.platform === "win32" ? name : path.join(os.tmpdir(), name)
		const address = process.platform === "win32" ? `\\\\.\\pipe\\${name}` : socketPath
		const server = new IpcServer(socketPath, () => {})
		t.after(() => server.close())
		server.listen()
		const ready = new Promise<void>((resolve) => ipc.server.on("start", resolve))
		return { server, address, ready }
	}

	it("does nothing when the server is not listening", () => {
		const server = new IpcServer("/unused-test.sock", () => {})
		server.close()
		assert.equal(server.isListening, false)
	})
	it("stops a listening server and disconnects its clients", { timeout: 2000 }, async (t) => {
		const { server, address, ready } = startServer(t)
		await ready
		assert.equal(server.isListening, true)
		const client = createConnection(address)
		t.after(() => client.destroy())
		await once(client, "data", { signal: t.signal })
		const closed = once(client, "close", { signal: t.signal })

		server.close()
		server.close()
		await closed
		assert.equal(server.isListening, false)
	})
	it("stops startup when closed before the listener is ready", { timeout: 2000 }, async (t) => {
		const { server, address, ready } = startServer(t)
		server.close()
		await ready

		const client = createConnection(address)
		t.after(() => client.destroy())
		await assert.rejects(once(client, "connect", { signal: t.signal }), /ENOENT|ECONNREFUSED/)
		assert.equal(server.isListening, false)
	})
})
