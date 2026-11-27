import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { deferred } from "../deferred"
import { openCodex } from "../codex"

const fake = String.raw`
const readline = require("node:readline")
if (process.argv.includes("--version")) {
	process.stdout.write("codex-cli 0.159.0\n")
	return
}
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n")
const response = (id, result) => send({ id, result })
const notice = (method, params) => send({ method, params })
const threadId = "thread-dory"
const turnId = "turn-native"
const cwd = process.cwd()
let approval
readline.createInterface({ input: process.stdin }).on("line", (line) => {
	const { id, method, params, result, error } = JSON.parse(line)
	if (id === 80 || id === 81) {
		if (id === 80) {
			if (!error) process.exit(5)
			return
		}
		approval = result.decision
		notice("item/completed", { threadId, turnId, item: {
			type: "commandExecution", id: "shell", command: "echo native",
			status: approval === "accept" ? "completed" : "declined" } })
		notice("turn/completed", { threadId, turn: { id: turnId, status: "completed" } })
		return
	}
	switch (method) {
		case "initialize": {
			const packet = JSON.stringify({ id, result: { userAgent: "Dory test é" } })
			const bytes = Buffer.from(packet + "\n" + JSON.stringify({ method: "additive" }) + "\n")
			const split = bytes.indexOf(0xc3) + 1
			process.stdout.write(bytes.subarray(0, split))
			setImmediate(() => process.stdout.write(bytes.subarray(split)))
			break
		}
		case "config/read": response(id, { config: { model_provider: "openai" } }); break
		case "account/read": response(id, { account: { type: "chatgpt", email: "test@example.invalid" } }); break
		case "account/rateLimits/read": response(id, { accountId: "workspace-1" }); break
		case "model/list":
			response(id, { data: [{ model: "gpt-5.6-sol", hidden: false, inputModalities: ["text", "image"] }] })
			break
		case "thread/start":
		case "thread/resume":
			if (method === "thread/resume" && params.threadId !== threadId) process.exit(4)
			response(id, { thread: { id: threadId }, cwd, model: params.model, modelProvider: "openai",
				approvalPolicy: params.approvalPolicy, approvalsReviewer: params.approvalsReviewer,
				sandbox: { type: "workspaceWrite", networkAccess: false } })
			break
		case "thread/turns/list":
			response(id, { data: [{ id: "old-turn", status: "completed", items: [{
				id: "persisted", type: "agentMessage", text: "Recovered text"
			}] }] })
			break
		case "turn/start":
			notice("turn/started", { threadId, turn: { id: turnId, status: "inProgress" } })
			response(id, { turn: { id: turnId, status: "inProgress" } })
			notice("item/agentMessage/delta", { threadId, turnId, itemId: "row1", delta: "Text delta" })
			send({ id: 80, method: "item/unknown/requestApproval", params: { threadId, turnId } })
			send({ id: 81, method: "item/commandExecution/requestApproval", params: {
				threadId, turnId, itemId: "shell", command: "echo native", kind: "command", cwd
			} })
			break
		case "turn/interrupt":
			response(id, {})
			break
	}
})
`

describe("Codex app-server", () => {
	const directories: string[] = []
	afterEach(async () => {
		vi.unstubAllEnvs()
		await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
	})

	async function connect() {
		const cwd = await mkdtemp(path.join(tmpdir(), "dory-codex-test-"))
		directories.push(cwd)
		await writeFile(path.join(cwd, "codex"), `#!${process.execPath}\n${fake}`, { mode: 0o700 })
		vi.stubEnv("PATH", cwd + path.delimiter + process.env.PATH)
		return openCodex({
			engine: "codex",
			route: "subscription",
			profileId: "p1",
			connection: "Local profile",
			model: "gpt-5.6-sol",
			cwd: await realpath(cwd),
			storage: cwd,
		})
	}

	it("settles Stop when Codex acknowledges interruption without a final notice", async () => {
		const runtime = await connect()
		const answer = deferred<boolean>()
		const approval = vi.fn(() => answer.promise)
		try {
			const turn = runtime.run(
				undefined,
				"Check this file",
				[],
				{ approval, row: vi.fn(), usage: vi.fn(), question: vi.fn(), started: vi.fn(async () => {}) },
				async () => {},
			)
			await vi.waitFor(() => expect(approval).toHaveBeenCalledOnce())
			await runtime.stop()
			await expect(turn).resolves.toBe("interrupted")
		} finally {
			answer.resolve(false)
			await runtime.close()
		}
	})

	it.each([true, false])("routes one scoped approval and reconciles saved output (%s)", async (allow) => {
		const runtime = await connect()
		try {
			const approval = vi.fn(async () => allow)
			const row = vi.fn()
			const bind = vi.fn(async () => {})
			const result = await runtime.run(
				"thread-dory",
				"Check the file",
				[],
				{ approval, row, usage: vi.fn(), question: vi.fn(), started: vi.fn(async () => {}) },
				bind,
			)
			expect(result).toBe("completed")
			expect(bind).toHaveBeenCalledExactlyOnceWith("thread-dory")
			expect(approval).toHaveBeenCalledExactlyOnceWith("Run command", expect.stringContaining("echo native"))
			expect(row).toHaveBeenCalledWith({ id: "persisted", kind: "assistant", text: "Recovered text" })
			expect(row).toHaveBeenCalledWith({ id: "row1", kind: "assistant", text: "Text delta" }, true)
			expect(row).toHaveBeenCalledWith({
				id: "shell",
				kind: "action",
				text: allow ? "echo native · completed" : "echo native · declined",
			})
		} finally {
			await runtime.close()
		}
	})
})
