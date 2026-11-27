import { mkdir } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { providerIdentifiers } from "@roo-code/types"

import { CodexTransport } from "./codexTransport"
import { fingerprint, installedRuntime, nativeEnvironment, NativeShutdownError, spawnNative } from "./process"
import type { AgentRoute, NativeRuntime } from "./runtime"
import { deferred } from "./deferred"

// Validated projection of the stable types emitted by 0.159.0 generate-ts.
const VERSION = "0.159.0"
const accountSchema = z.object({ account: z.object({ type: z.string(), email: z.string().nullish() }).nullable() })
const configSchema = z.object({
	config: z.object({
		openai_base_url: z.string().nullish(),
		chatgpt_base_url: z.string().nullish(),
		model_provider: z.string().nullish(),
		model_providers: z.record(z.string(), z.unknown()).nullish(),
	}),
})
const modelsSchema = z.object({
	data: z.array(z.object({ model: z.string(), hidden: z.boolean(), inputModalities: z.array(z.string()) })),
	nextCursor: z.string().nullish(),
})
const itemSchema = z.object({
	id: z.string(),
	type: z.string(),
	text: z.string().optional(),
	command: z.string().optional(),
	cwd: z.string().optional(),
	status: z.string().optional(),
	changes: z.array(z.object({ path: z.string() })).optional(),
	tool: z.string().optional(),
	server: z.string().optional(),
	content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
})
const turnSchema = z.object({ id: z.string(), status: z.string(), items: z.array(itemSchema).optional() })
const threadSchema = z.object({
	thread: z.object({ id: z.string() }),
	model: z.string(),
	modelProvider: z.literal(providerIdentifiers.openai),
	cwd: z.string(),
	approvalPolicy: z.literal("on-request"),
	approvalsReviewer: z.literal("user"),
	sandbox: z.object({ type: z.literal("workspaceWrite"), networkAccess: z.literal(false) }),
})
const routedEvent = z.object({
	threadId: z.string(),
	turnId: z.string().optional(),
	turn: turnSchema.optional(),
	item: itemSchema.optional(),
	itemId: z.string().optional(),
	delta: z.string().optional(),
	command: z.string().nullish(),
	cwd: z.string().nullish(),
	kind: z.string().optional(),
	reason: z.string().nullish(),
	grantRoot: z.string().nullish(),
	networkApprovalContext: z.unknown().optional(),
	tokenUsage: z.object({ total: z.object({ inputTokens: z.number(), outputTokens: z.number() }) }).optional(),
})

export async function openCodex(route: AgentRoute): Promise<NativeRuntime> {
	const executable = await installedRuntime("codex", VERSION)
	const env = nativeEnvironment()
	if (route.apiKey) {
		env.CODEX_HOME = path.join(route.storage, "native-codex-api", fingerprint(route.profileId))
		await mkdir(env.CODEX_HOME, { recursive: true, mode: 0o700 })
	}
	const rpc = new CodexTransport(
		spawnNative(
			executable,
			[
				"app-server",
				"--stdio",
				"-c",
				'model_provider="openai"',
				"-c",
				"analytics.enabled=false",
				"-c",
				"sandbox_workspace_write.network_access=false",
				"-c",
				'shell_environment_policy.inherit="none"',
				...(route.apiKey
					? ["-c", 'cli_auth_credentials_store="ephemeral"', "-c", 'forced_login_method="api"']
					: []),
			],
			route.cwd,
			env,
		),
	)
	try {
		await rpc.request("initialize", {
			clientInfo: { name: "dory_code", title: "Dory Code", version: "1" },
			capabilities: { experimentalApi: false, requestAttestation: false },
		})
		rpc.notify("initialized")
		const { config } = configSchema.parse(
			await rpc.request("config/read", { cwd: route.cwd, includeLayers: false }),
		)
		if (
			(config.openai_base_url && config.openai_base_url.replace(/\/$/, "") !== "https://api.openai.com/v1") ||
			(config.chatgpt_base_url &&
				config.chatgpt_base_url.replace(/\/$/, "") !== "https://chatgpt.com/backend-api") ||
			(config.model_provider && config.model_provider !== providerIdentifiers.openai) ||
			config.model_providers?.openai
		) {
			throw new Error("Use the direct OpenAI connection in Codex. Dory detected a native endpoint override.")
		}
		if (route.apiKey) {
			await rpc.request("account/login/start", { type: "apiKey", apiKey: route.apiKey })
		}
		const { account } = accountSchema.parse(await rpc.request("account/read", { refreshToken: false }))
		let accountScope: string
		if (route.route === "subscription" && account?.type === "chatgpt" && account.email) {
			const scope = z
				.object({ accountId: z.string().nullable() })
				.parse(await rpc.request("account/rateLimits/read", {})).accountId
			if (!scope) throw new Error("Codex did not identify the signed-in workspace. Check Codex sign-in.")
			accountScope = fingerprint(account.email, scope)
		} else if (route.route === "api-key" && route.apiKey && account?.type === "apiKey") {
			accountScope = fingerprint(route.profileId, route.apiKey)
		} else {
			throw new Error("Sign in with the selected billing route in Codex settings.")
		}
		let catalogModel: z.infer<typeof modelsSchema>["data"][number] | undefined
		let cursor: string | null | undefined
		for (let page = 0; page < 5; page++) {
			const catalog = modelsSchema.parse(await rpc.request("model/list", { cursor, limit: 100 }))
			catalogModel = catalog.data.find((model) => !model.hidden && model.model === route.model)
			cursor = catalog.nextCursor
			if (catalogModel || !cursor) break
		}
		if (!catalogModel) throw new Error("Codex does not list this model. Select a model available in Codex.")
		let threadId: string | undefined
		let turnId: string | undefined
		let stopped = false
		let interrupt: Promise<void> | undefined
		let finishStoppedTurn: (() => void) | undefined
		const requests = new Set<string | number>()
		const commandsInProgress = new Set<string>()

		return {
			identity: { accountScope, version: VERSION, images: catalogModel.inputModalities.includes("image") },
			async run(nativeId, text, images, output, bind) {
				if (stopped) return "interrupted"
				const settings = {
					cwd: route.cwd,
					model: route.model,
					modelProvider: providerIdentifiers.openai,
					approvalPolicy: "on-request",
					approvalsReviewer: "user",
					sandbox: "workspace-write",
				}
				const created = threadSchema.parse(
					await rpc.request(
						nativeId ? "thread/resume" : "thread/start",
						nativeId ? { ...settings, threadId: nativeId, excludeTurns: true } : settings,
					),
				)
				if (
					created.model !== route.model ||
					created.cwd !== route.cwd ||
					(nativeId && created.thread.id !== nativeId)
				) {
					throw new Error("Codex returned a different session, model, or workspace.")
				}
				threadId = created.thread.id
				await bind(threadId)
				const projectItem = (item: z.infer<typeof itemSchema>) => {
					if (item.type === "commandExecution") {
						if (item.status === "inProgress") commandsInProgress.add(item.id)
						else if (item.status) commandsInProgress.delete(item.id)
					}
					if (item.type === "agentMessage" && item.text !== undefined) {
						output.row({ id: item.id, kind: "assistant", text: item.text })
					} else if (
						item.type === "commandExecution" ||
						item.type === "fileChange" ||
						item.type === "mcpToolCall" ||
						item.type === "collabAgentToolCall"
					) {
						const detail =
							item.command ??
							item.changes?.map(({ path: file }) => file).join(", ") ??
							[item.server, item.tool].filter(Boolean).join(" ")
						output.row({
							id: item.id,
							kind: "action",
							text: [detail || item.type, item.status].filter(Boolean).join(" · "),
						})
					}
				}
				if (nativeId) {
					let historyCursor: string | null | undefined
					const pages: z.infer<typeof turnSchema>[][] = []
					for (let page = 0; page < 4; page++) {
						const history = z.object({ data: z.array(turnSchema), nextCursor: z.string().nullish() }).parse(
							await rpc.request("thread/turns/list", {
								threadId,
								cursor: historyCursor,
								itemsView: "full",
								limit: 20,
							}),
						)
						pages.push(history.data)
						historyCursor = history.nextCursor
						if (!historyCursor) break
					}
					for (const turn of pages.flat().reverse()) turn.items?.forEach(projectItem)
					commandsInProgress.clear()
				}
				if (stopped) return "interrupted"
				const terminal = deferred<"completed" | "interrupted">()
				finishStoppedTurn = () => terminal.resolve("interrupted")
				// Turn notifications can arrive before the request response.
				void terminal.promise.catch(() => {})
				rpc.onFailure = terminal.reject
				rpc.onMessage = (method, params, id) => {
					if (id !== undefined) {
						if (requests.has(id)) return
						if (requests.size >= 1000) {
							rpc.reject(id)
							return
						}
						requests.add(id)
					}
					const event = routedEvent.safeParse(params)
					if (method === "account/updated") {
						terminal.reject(new Error("The Codex account changed. Run setup again before resuming."))
						return
					}
					if (!event.success || event.data.threadId !== threadId) {
						if (id !== undefined) rpc.reject(id)
						return
					}
					const data = event.data
					const eventTurn = data.turnId ?? data.turn?.id
					if (!eventTurn || (turnId ? eventTurn !== turnId : method !== "turn/started")) {
						if (id !== undefined) rpc.reject(id)
						return
					}
					turnId = eventTurn
					if (id !== undefined) {
						const command =
							method === "item/commandExecution/requestApproval" &&
							data.kind === "command" &&
							!data.networkApprovalContext &&
							data.command
						const file = method === "item/fileChange/requestApproval" && !data.grantRoot
						if (!command && !file) {
							rpc.reject(id)
							return
						}
						if (stopped) {
							rpc.reply(id, { decision: "decline" })
							return
						}
						const detail = command
							? [data.command, data.cwd].filter(Boolean).join("\n")
							: (data.reason ?? "Apply this change")
						void output.approval(command ? "Run command" : "Change files", detail).then(
							(allow) => rpc.reply(id, { decision: allow && !stopped ? "accept" : "decline" }),
							() => rpc.reply(id, { decision: "decline" }),
						)
						return
					}
					switch (method) {
						case "item/agentMessage/delta":
							if (data.itemId && data.delta)
								output.row({ id: data.itemId, kind: "assistant", text: data.delta }, true)
							break
						case "item/started":
						case "item/completed":
							if (data.item) projectItem(data.item)
							break
						case "thread/tokenUsage/updated":
							if (data.tokenUsage)
								output.usage(data.tokenUsage.total.inputTokens, data.tokenUsage.total.outputTokens)
							break
						case "turn/completed":
							data.turn?.items?.forEach(projectItem)
							if (data.turn?.status === "completed") terminal.resolve("completed")
							else if (data.turn?.status === "interrupted") terminal.resolve("interrupted")
							else
								terminal.reject(
									new Error("The Codex turn failed. Check model access and Codex account limits."),
								)
							break
					}
				}
				try {
					const started = z.object({ turn: turnSchema }).parse(
						await rpc.request("turn/start", {
							threadId,
							input: [
								...(text ? [{ type: "text", text, text_elements: [] }] : []),
								...images.map((url) => ({ type: "image", url })),
							],
						}),
					)
					if (turnId && turnId !== started.turn.id) throw new Error("Codex returned a different turn ID.")
					turnId = started.turn.id
					if (stopped) return "interrupted"
					await output.started()
					return await terminal.promise
				} finally {
					rpc.onMessage = undefined
					rpc.onFailure = undefined
					finishStoppedTurn = undefined
				}
			},
			stop() {
				stopped = true
				interrupt ??= (async () => {
					if (threadId && turnId)
						await rpc.request("turn/interrupt", { threadId, turnId }, 2500).catch(() => {})
					try {
						await rpc.close()
					} finally {
						finishStoppedTurn?.()
					}
				})()
				return interrupt
			},
			async close() {
				await rpc.close()
				if (commandsInProgress.size) {
					throw new NativeShutdownError("Codex exited while a command was still active.")
				}
			},
		}
	} catch (error) {
		await rpc.close()
		throw error
	}
}
