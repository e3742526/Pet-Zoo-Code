import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import * as vscode from "vscode"
import { z } from "zod"

import {
	getAgentProfileModelId,
	nativeAgentCommandSchema,
	nativeAgentSessionSchema,
	type HistoryItem,
	type NativeAgentAvailability,
	type NativeAgentCommand,
	type NativeAgentHandoff,
	type NativeAgentRow,
	type NativeAgentQuestion,
	type NativeAgentSession,
	type NativeAgentView,
} from "@roo-code/types"

import { mentionRegex } from "../../shared/context-mentions"
import { getTaskDirectoryPath } from "../../utils/storage"
import { redactSecrets } from "../../utils/redactSecrets"
import { ProfileValidator } from "../../shared/ProfileValidator"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { beginNativeTurn, settleNativeTurn } from "../task-persistence/taskLifecycle"
import type { TaskScheduler } from "../task/TaskScheduler"
import type { ClineProvider } from "../webview/ClineProvider"
import { claimAgentCheckout } from "./checkoutWriter"
import { openCodex } from "./codex"
import { openClaude, supportedClaudeImage } from "./claude"
import { engineForProvider, resolveAgentConnection } from "./eligibility"
import { executionHost, fingerprint, NativeDisconnectedError, NativeShutdownError, workspaceIdentity } from "./process"
import { captureRecoveryPoint, exportRecoveryPoint, reviewWorkspace } from "./workspaceRecovery"
import type { AgentRoute, NativeRuntime } from "./runtime"
import { deferred } from "./deferred"

type NativeRun = {
	abort: boolean
	runtime?: NativeRuntime
	promise?: Promise<void>
	cleanupUncertain?: boolean
}
type PendingApproval = {
	id: string
	finish: (allowed: boolean) => void
}
const MAX_ROWS = 250
const MAX_ROW_TEXT = 32_000
const MAX_IMAGE_DATA = 12_000_000
const rowsSchema = z.array(
	z.object({
		id: z.string(),
		kind: z.enum(["user", "assistant", "action", "notice"]),
		text: z.string(),
	}),
)

function engineMessage(error: unknown) {
	if (error instanceof z.ZodError) return "The native runtime returned an incompatible response."
	return error instanceof Error && !("code" in error)
		? redactSecrets(error.message.slice(0, 300))
		: "The native agent could not complete this operation."
}

function openRuntime(route: AgentRoute, nativeId?: string) {
	return route.engine === "codex" ? openCodex(route) : openClaude(route, nativeId)
}

export class NativeAgentController {
	private active?: NativeAgentView
	private generation = 0
	private handoff?: {
		draft: NativeAgentHandoff
		sourceId: string
		profileId: string
		checkout: string
		reviewedState: string
		selection?: string
	}
	private run?: NativeRun
	private approval?: PendingApproval
	private question?: {
		id: string
		finish: (answers?: Record<string, string>) => void
	}
	private selection?: { token: string; expires: number }
	private actions = Promise.resolve()
	private discovery?: { key: string; promise: Promise<NativeAgentAvailability | undefined> }

	constructor(
		private readonly provider: ClineProvider,
		private readonly scheduler: TaskScheduler,
	) {}

	get view() {
		return this.active
	}

	private get storage() {
		return this.provider.context.globalStorageUri.fsPath
	}

	private async rowsFile(taskId: string) {
		const directory = await getTaskDirectoryPath(this.storage, taskId)
		return path.join(directory, "native_transcript.json")
	}

	private async persistRows(view: NativeAgentView) {
		await safeWriteJson(await this.rowsFile(view.taskId), [...view.rows])
	}

	private async publish() {
		await this.provider.postStateToWebviewWithoutTaskHistory()
	}

	private assertHost() {
		if (!vscode.workspace.isTrusted) throw new Error("Trust the workspace before using a native agent.")
		if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
			throw new Error("Open one workspace folder before using a native agent.")
		}
		if (
			!this.provider.cwd ||
			process.env.ROO_CLI_RUNTIME === "1" ||
			vscode.env.remoteName ||
			!["darwin", "linux"].includes(process.platform)
		) {
			throw new Error("Native agents require a local workspace on macOS or Linux.")
		}
	}

	private async connection(profileId: string, model?: string, requireCurrent = true) {
		const [state, profile] = await Promise.all([
			this.provider.getState({ includeTaskHistory: false }),
			this.provider.providerSettingsManager.getProfile({ id: profileId }),
		])
		const actualModel = getAgentProfileModelId(profile)
		if (
			(requireCurrent &&
				(profile.name !== state.currentApiConfigName ||
					actualModel !== getAgentProfileModelId(state.apiConfiguration))) ||
			(model !== undefined && model !== actualModel)
		) {
			throw new Error("The provider or model changed. Select the engine again.")
		}
		return { profile, allowList: state.organizationAllowList }
	}

	private async route(profileId: string, model?: string, requireCurrent = true) {
		this.assertHost()
		const { profile, allowList } = await this.connection(profileId, model, requireCurrent)
		const workspace = await workspaceIdentity(this.provider.cwd!)
		return {
			route: { ...resolveAgentConnection(profile, allowList), cwd: workspace.cwd, storage: this.storage },
			workspace,
			preference: profile.agentEngine ?? "dory",
		}
	}

	private async discover(profileId: string, model: string): Promise<NativeAgentAvailability | undefined> {
		const generation = this.generation
		const { profile } = await this.connection(profileId, model)
		const engine = engineForProvider(profile.apiProvider)
		if (!engine) return undefined
		const result: NativeAgentAvailability = {
			engine,
			profileId,
			model,
			route: profile.nativeAgentAuth,
			connection: profile.name,
		}
		try {
			const { route, workspace } = await this.route(profileId, model)
			const runtime = await openRuntime(route)
			await runtime.close()
			await this.connection(profileId, model)
			if (generation !== this.generation) return undefined
			const token = fingerprint(profileId, model, route.route, workspace.checkout, runtime.identity.accountScope)
			this.selection = { token, expires: Date.now() + 10 * 60_000 }
			return { ...result, selection: token, runtime: runtime.identity.version, images: runtime.identity.images }
		} catch (error) {
			return { ...result, reason: engineMessage(error) }
		}
	}

	private checkSelection(selection: string | undefined, route: AgentRoute, checkout: string, runtime: NativeRuntime) {
		const token = fingerprint(route.profileId, route.model, route.route, checkout, runtime.identity.accountScope)
		if (
			!selection ||
			token !== selection ||
			this.selection?.token !== token ||
			this.selection.expires < Date.now()
		) {
			throw new Error("The native connection changed. Refresh its setup and select the engine again.")
		}
	}

	private async prefer(command: Extract<NativeAgentCommand, { kind: "prefer" }>) {
		if (this.active || this.provider.getCurrentTask()) throw new Error("Start a new task to change its engine.")
		const { profile, allowList } = await this.connection(command.profileId, command.model)
		if (command.engine !== "dory") {
			const route = resolveAgentConnection(profile, allowList)
			if (
				route.engine !== command.engine ||
				command.selection !== this.selection?.token ||
				!this.selection ||
				this.selection.expires < Date.now()
			) {
				throw new Error("Check the native agent setup before selecting it.")
			}
		}
		await this.provider.setAgentEnginePreference(command.profileId, command.model, command.engine)
	}

	private async approve(view: NativeAgentView, run: NativeRun, operation: string, detail: string): Promise<boolean> {
		if (this.active !== view || this.run !== run || run.abort || this.approval || this.question) return false
		const id = randomUUID()
		const answer = deferred<boolean>()
		const timer = setTimeout(() => this.approval?.id === id && this.approval.finish(false), 120_000)
		this.approval = {
			id,
			finish: (allow) => {
				clearTimeout(timer)
				this.approval = undefined
				view.approval = undefined
				if (!run.abort) view.status = "running"
				answer.resolve(allow)
				void this.publish().catch(() => {})
			},
		}
		view.status = "approval"
		view.approval = { id, operation: operation.slice(0, 100), detail: redactSecrets(detail.slice(0, 4000)) }
		await this.publish().catch(() => this.approval?.finish(false))
		return answer.promise
	}

	private async askQuestion(view: NativeAgentView, run: NativeRun, questions: NativeAgentQuestion[]) {
		if (this.active !== view || this.run !== run || run.abort || this.approval || this.question) return undefined
		const id = randomUUID()
		const answer = deferred<Record<string, string> | undefined>()
		const timer = setTimeout(() => this.question?.id === id && this.question.finish(), 120_000)
		this.question = {
			id,
			finish: (answers) => {
				clearTimeout(timer)
				this.question = undefined
				view.question = undefined
				if (!run.abort) view.status = "running"
				answer.resolve(answers)
				void this.publish().catch(() => {})
			},
		}
		view.status = "input"
		view.question = { id, questions }
		await this.publish().catch(() => this.question?.finish())
		return answer.promise
	}

	private addRow(view: NativeAgentView, row: NativeAgentRow, append = false) {
		const index = view.rows.findIndex(({ id }) => id === row.id)
		const previous = index === -1 ? undefined : view.rows[index]
		const text = redactSecrets((append && previous ? previous.text + row.text : row.text).slice(0, MAX_ROW_TEXT))
		if (previous) view.rows[index] = { ...row, text }
		else view.rows.push({ ...row, text })
		if (view.rows.length > MAX_ROWS) view.rows.shift()
	}

	private async send(
		command: Extract<NativeAgentCommand, { kind: "send" }>,
		continuation?: NonNullable<NativeAgentController["handoff"]>,
	) {
		const { text, images } = command
		const generation = this.generation
		if (this.handoff && !continuation) throw new Error("Complete or cancel the handoff before sending.")
		if (command.hasAttachments || mentionRegex.test(text) || /^\s*\/[\w-]+(?:\s|$)/.test(text)) {
			throw new Error("Remove Dory context attachments or slash commands before sending to a native agent.")
		}
		if (
			(!text.trim() && images.length === 0) ||
			images.reduce((length, image) => length + image.length, 0) > MAX_IMAGE_DATA ||
			!images.every(supportedClaudeImage)
		) {
			throw new Error("Enter a prompt or attach up to four supported images within the size limit.")
		}
		if (this.run) throw new Error("Wait for the current turn or stop it before sending again.")
		const current = this.active
		if (current?.taskId !== command.taskId || this.provider.getCurrentTask())
			throw new Error("The active task changed.")
		if (current && !current.session) throw new Error("This native session version cannot run.")
		const previousTarget = continuation && this.provider.taskHistoryStore.get(continuation.draft.id)
		const savedTarget = nativeAgentSessionSchema.safeParse(
			previousTarget ? previousTarget.nativeSession : undefined,
		)
		if (previousTarget && (!savedTarget.success || previousTarget.continuedFromTaskId !== continuation?.sourceId)) {
			throw new Error("The linked target record changed. Reopen it from history.")
		}
		const existing = current?.session ?? (savedTarget.success ? savedTarget.data : undefined)
		const profileId = existing?.profileId ?? command.profileId
		if (!profileId) throw new Error("Select a provider profile.")
		const { route, workspace, preference } = await this.route(profileId, existing?.model ?? command.model, !current)
		if (!existing && !continuation && preference !== route.engine)
			throw new Error("Select the native engine before sending.")
		if (
			existing &&
			(existing.engine !== route.engine ||
				existing.route !== route.route ||
				existing.host !== executionHost ||
				existing.cwd !== workspace.cwd ||
				existing.checkout !== workspace.checkout)
		) {
			throw new Error("This session belongs to a different connection, host, or checkout.")
		}

		if (generation !== this.generation || current !== this.active || this.provider.getCurrentTask()) {
			throw new Error("The active task changed during setup.")
		}
		const run: NativeRun = { abort: false }
		this.run = run
		const accepted = deferred<void>()
		const scheduled = this.scheduler.schedule(run, async () => {
			const release = await claimAgentCheckout(workspace.root)
			let view = current
			let updateTimer: ReturnType<typeof setTimeout> | undefined
			let projectionSave = Promise.resolve()
			let lastProjectionSave = 0
			let runtimeClosed = false
			let attemptGeneration: number | undefined
			try {
				if (run.abort) throw new Error("The native start was canceled.")
				const runtime = await openRuntime(route, existing?.nativeId)
				run.runtime = runtime
				if (existing) {
					if (
						existing.accountScope !== runtime.identity.accountScope ||
						existing.runtime !== runtime.identity.version
					) {
						throw new Error("The runtime version or account differs from the saved session.")
					}
				} else {
					this.checkSelection(command.selection, route, workspace.checkout, runtime)
				}
				const latest = await this.route(profileId, existing?.model ?? command.model, !current)
				if (
					(!existing && !continuation && latest.preference !== route.engine) ||
					latest.route.route !== route.route ||
					latest.route.engine !== route.engine ||
					latest.route.apiKey !== route.apiKey ||
					latest.workspace.checkout !== workspace.checkout
				) {
					throw new Error("The native connection changed during startup.")
				}
				if (images.length && !runtime.identity.images)
					throw new Error("The selected native model does not accept images.")
				if (run.abort) throw new Error("The native start was canceled.")
				const session =
					existing ??
					({
						version: 1,
						engine: route.engine,
						profileId,
						connection: route.connection,
						model: route.model,
						route: route.route,
						cwd: workspace.cwd,
						checkout: workspace.checkout,
						host: executionHost,
						runtime: runtime.identity.version,
						imagesSupported: runtime.identity.images,
						accountScope: runtime.identity.accountScope,
						createdAt: Date.now(),
					} satisfies NativeAgentSession)
				const task =
					view ??
					({
						taskId: continuation?.draft.id ?? randomUUID(),
						engine: session.engine,
						session,
						status: "starting",
						rows: [],
					} satisfies NativeAgentView)
				view = task
				task.canSendImages = runtime.identity.images
				task.status = "starting"
				task.error = undefined
				this.active = task
				let item: HistoryItem = this.provider.taskHistoryStore.get(task.taskId) ?? {
					id: task.taskId,
					number: 1,
					ts: Date.now(),
					task: text.slice(0, 4000) || "Image task",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
					workspace: workspace.cwd,
					apiConfigName: route.connection,
					engine: session.engine,
					nativeSession: session,
					continuedFromTaskId: continuation?.sourceId,
				}
				if (!existing) {
					await this.provider.updateTaskHistory(item)
					const captured = await captureRecoveryPoint(task.taskId, this.storage, workspace)
					if (!captured)
						this.addRow(task, {
							id: randomUUID(),
							kind: "notice",
							text: "A file recovery snapshot is unavailable.",
						})
				}
				await this.publish()
				const refresh = () => {
					if (updateTimer) return
					updateTimer = setTimeout(() => {
						updateTimer = undefined
						if (this.active === task && this.run === run) {
							void this.publish().catch(() => {})
							if (Date.now() - lastProjectionSave >= 1000) {
								lastProjectionSave = Date.now()
								projectionSave = projectionSave.then(() => this.persistRows(task)).catch(() => {})
							}
						}
					}, 100)
				}
				const result = await runtime.run(
					session.nativeId,
					text,
					images,
					{
						started: async () => {
							if (run.abort || this.run !== run) throw new Error("The native start was canceled.")
							if (!task.approval && !task.question) task.status = "running"
							accepted.resolve()
							await this.publish()
						},
						row: (row, append) => {
							if (!run.abort && this.run === run) {
								this.addRow(task, row, append)
								refresh()
							}
						},
						approval: (operation, detail) => this.approve(task, run, operation, detail),
						question: (questions) => this.askQuestion(task, run, questions),
						usage: (input, output) => {
							task.usage = { input, output }
							refresh()
						},
					},
					async (nativeId) => {
						if (run.abort) throw new Error("The native start was canceled.")
						task.session = { ...session, nativeId }
						const descriptor = task.session
						await this.provider.taskHistoryStore.atomicReadAndUpdate(task.taskId, (record) => {
							item = beginNativeTurn({ ...record, nativeSession: descriptor })
							attemptGeneration = item.attemptGeneration
							return item
						})
						if (run.abort) throw new Error("The native start was canceled.")
						this.addRow(task, {
							id: randomUUID(),
							kind: "user",
							text: text + (images.length ? `\n[${images.length} attached images]` : ""),
						})
						await this.persistRows(task)
						if (item.continuedFromTaskId) await this.provider.recordTaskContinuation(item)
					},
				)
				task.status = result === "completed" && !run.abort ? "turn-completed" : "stopped"
			} catch (error) {
				if (error instanceof NativeShutdownError) run.cleanupUncertain = true
				accepted.reject(new Error(engineMessage(error)))
				if (view) {
					view.status = run.abort
						? "stopped"
						: error instanceof NativeDisconnectedError
							? "disconnected"
							: "failed"
					view.error = run.abort ? undefined : engineMessage(error)
				}
			} finally {
				if (updateTimer) clearTimeout(updateTimer)
				this.approval?.finish(false)
				this.question?.finish()
				try {
					await run.runtime?.close()
					runtimeClosed = true
					if (!run.cleanupUncertain) await release()
				} catch {
					run.cleanupUncertain = true
					if (view) {
						view.status = "disconnected"
						view.error = "Native shutdown could not be verified. Check the checkout before continuing."
					}
				}
				if (view) {
					await projectionSave
					await this.persistRows(view)
					const status = view.status
					if (
						attemptGeneration !== undefined &&
						(status === "turn-completed" ||
							status === "stopped" ||
							status === "failed" ||
							status === "disconnected")
					) {
						const ownedGeneration = attemptGeneration
						await this.provider.taskHistoryStore.atomicReadAndUpdate(view.taskId, (record) =>
							settleNativeTurn(record, ownedGeneration, status),
						)
					}
				}
				if (runtimeClosed && !run.cleanupUncertain) this.run = undefined
				await this.publish()
			}
		})
		run.promise = scheduled
			.catch((error) => {
				if (!run.cleanupUncertain && this.run === run) this.run = undefined
				accepted.reject(new Error(engineMessage(error)))
			})
			.finally(() => {
				accepted.reject(new Error("The native start was canceled."))
				if (!run.cleanupUncertain && this.run === run) this.run = undefined
			})
		return accepted.promise.catch(async (error) => {
			await run.promise
			throw error
		})
	}

	async stop(taskId?: string) {
		if (taskId !== undefined && taskId !== this.active?.taskId) return
		const run = this.run
		if (!run) return
		run.abort = true
		if (this.active) this.active.status = "stopping"
		this.approval?.finish(false)
		this.question?.finish()
		if (run.runtime) await run.runtime.stop().catch(() => {})
		await run.promise
		if (run.cleanupUncertain) throw new Error("Dory could not verify native shutdown for this checkout.")
	}

	async clear() {
		this.generation++
		await this.stop()
		this.active = undefined
		this.selection = undefined
		this.handoff = undefined
	}

	async show(item: HistoryItem) {
		await this.clear()
		const generation = this.generation
		const descriptor = nativeAgentSessionSchema.safeParse(item.nativeSession)
		const session = descriptor.success && descriptor.data.engine === item.engine ? descriptor.data : undefined
		const rows = rowsSchema
			.catch([])
			.parse(JSON.parse(await readFile(await this.rowsFile(item.id), "utf8").catch(() => "[]")))
		if (generation !== this.generation || this.provider.getCurrentTask()) return
		this.active = {
			taskId: item.id,
			engine: item.engine ?? "dory",
			session,
			canSendImages: session?.imagesSupported,
			rows,
			status: !session
				? "unsupported"
				: item.nativeTurnState === "running"
					? "disconnected"
					: (item.nativeTurnState ?? "idle"),
			error: !session
				? "This task uses an unsupported agent engine or session version."
				: item.nativeTurnState === "running"
					? "The previous turn ended without a confirmed result. Review the checkout before sending."
					: undefined,
		}
		await this.publish()
	}

	private async captureHandoffState(workspace: Awaited<ReturnType<typeof workspaceIdentity>>) {
		const [base, changes, tracked] = await Promise.all([
			workspace.git(["rev-parse", "HEAD"]).catch(() => "Unavailable"),
			workspace.git(["status", "--porcelain=v1", "--untracked-files=all"]).catch(() => "Unavailable"),
			workspace.git(["diff", "--no-ext-diff", "--no-textconv", "HEAD"]).catch(() => "Unavailable"),
		])
		return { base, changes, reviewedState: fingerprint(base, changes, tracked) }
	}

	private async prepareContinuation(
		command: Extract<NativeAgentCommand, { kind: "prepare-continuation" }>,
	): Promise<NativeAgentHandoff> {
		this.assertHost()
		const source = this.provider.taskHistoryStore.get(command.taskId)
		const native = this.active
		const dory = this.provider.getCurrentTask()
		const currentId = native?.taskId ?? dory?.taskId
		if (!source || currentId !== command.taskId || (source.engine ?? "dory") === command.engine) {
			throw new Error("Open the source task before preparing a continuation.")
		}
		if (source.status === "delegated" || source.parentTaskId) {
			throw new Error("Finish the delegated task and reopen its parent before continuing with another engine.")
		}
		const { profile, allowList } = await this.connection(command.profileId, command.model)
		const workspace = await workspaceIdentity(this.provider.cwd!)
		if (
			(native?.session && native.session.checkout !== workspace.checkout) ||
			(dory && (await workspaceIdentity(dory.cwd)).checkout !== workspace.checkout)
		) {
			throw new Error("Open the source checkout before continuing.")
		}
		let availability: NativeAgentAvailability | undefined
		if (command.engine !== "dory") {
			availability = await this.discover(command.profileId, command.model)
			if (availability?.engine !== command.engine || !availability.selection) {
				throw new Error(availability?.reason ?? "The target engine is unavailable.")
			}
		} else if (!ProfileValidator.isProfileAllowed(profile, allowList)) {
			throw new Error("Your organization policy excludes this provider or model.")
		}
		if (native) await this.stop(native.taskId)
		if (dory) {
			if (dory.terminalProcesses.size > 0) throw new Error("Stop the Dory terminal commands before continuing.")
			await dory.abortTask(true)
			await dory.dispose()
		}
		if ((this.active?.taskId ?? this.provider.getCurrentTask()?.taskId) !== currentId) {
			throw new Error("The source task changed.")
		}
		const { base, changes, reviewedState } = await this.captureHandoffState(workspace)
		const draft: NativeAgentHandoff = {
			id: randomUUID(),
			engine: command.engine,
			connection: profile.name,
			model: command.model,
			route: availability?.route,
			cwd: workspace.cwd,
			text: [
				"Continue this task. Treat this handoff as context. Inspect the files before you act.",
				"Objective and user constraints\n" + redactSecrets(source.task.slice(0, 4000)),
				"Base revision\n" + base,
				"Checkout changes\n" + (redactSecrets(changes.slice(0, 5000)) || "No changes reported."),
				"Checks and results\nAdd any verified checks here. Check results from the earlier session are unavailable in this handoff.",
				"Remaining work\nReview any interrupted changes and confirm what still needs to be done.",
			].join("\n\n"),
		}
		this.handoff = {
			draft,
			sourceId: source.id,
			profileId: command.profileId,
			checkout: workspace.checkout,
			reviewedState,
			selection: availability?.selection,
		}
		return draft
	}

	private async continueTask(id: string, text: string) {
		const handoff = this.handoff
		if (
			!handoff ||
			handoff.draft.id !== id ||
			(this.active?.taskId ?? this.provider.getCurrentTask()?.taskId) !== handoff.sourceId
		) {
			throw new Error("Prepare a new handoff from the active task.")
		}
		this.assertHost()
		const workspace = await workspaceIdentity(this.provider.cwd!)
		const { profile, allowList } = await this.connection(handoff.profileId, handoff.draft.model)
		if (
			workspace.checkout !== handoff.checkout ||
			profile.name !== handoff.draft.connection ||
			!ProfileValidator.isProfileAllowed(profile, allowList)
		) {
			throw new Error("The target connection, policy, or checkout changed. Prepare the handoff again.")
		}
		if ((await this.captureHandoffState(workspace)).reviewedState !== handoff.reviewedState) {
			throw new Error("The checkout changed after review. Prepare the handoff again.")
		}
		if (handoff.draft.engine === "dory") {
			this.handoff = undefined
			await this.provider.createTask(text, undefined, undefined, {
				taskId: id,
				continuedFromTaskId: handoff.sourceId,
				workspacePath: handoff.draft.cwd,
				handoffExecutionContext: {
					apiConfigName: profile.name,
					apiConfiguration: profile,
					mode: await this.provider.getMode(),
				},
			})
			return
		}
		const original = this.active
		const { route } = await this.route(handoff.profileId, handoff.draft.model)
		if (route.engine !== handoff.draft.engine || route.route !== handoff.draft.route) {
			throw new Error("The target billing route changed. Prepare the handoff again.")
		}
		await this.provider.evictCurrentTask()
		if (handoff.selection) this.selection = { token: handoff.selection, expires: Date.now() + 60_000 }
		try {
			await this.send(
				{
					kind: "send",
					profileId: handoff.profileId,
					model: handoff.draft.model,
					selection: handoff.selection,
					text,
					images: [],
					hasAttachments: false,
				},
				handoff,
			)
		} catch (error) {
			await this.run?.promise
			if (!this.run?.cleanupUncertain) {
				this.active = original
				this.handoff = handoff
				if (!original) {
					const source = this.provider.taskHistoryStore.get(handoff.sourceId)
					if (source) await this.provider.createTaskWithHistoryItem(source)
				}
				await this.publish()
			}
			throw error
		}
	}

	async export(item: HistoryItem) {
		const rows = rowsSchema.parse(
			JSON.parse(await readFile(await this.rowsFile(item.id), "utf8").catch(() => "[]")),
		)
		const uri = await vscode.window.showSaveDialog({ filters: { Markdown: ["md"] } })
		if (!uri) return
		const text = [
			`# ${item.engine} task`,
			redactSecrets(item.task),
			...(item.continuedFromTaskId ? [`Continued from ${item.continuedFromTaskId}`] : []),
			...(item.continuedToTaskIds ?? []).map((id) => `Continued as ${id}`),
			...rows.map((row) => `## ${row.kind}\n\n${row.text}`),
		].join("\n\n")
		await vscode.workspace.fs.writeFile(uri, Buffer.from(text))
	}

	async handle(input: unknown, requestId: string | undefined) {
		if (typeof requestId !== "string" || requestId.length > 100) return
		const reply = (result: {
			availability?: NativeAgentAvailability
			handoff?: NativeAgentHandoff
			error?: string
		}) =>
			this.provider.postMessageToWebview({
				type: "nativeAgentResult",
				nativeAgentResult: { requestId, ...result },
			})
		try {
			const command = nativeAgentCommandSchema.parse(input)
			if (command.kind === "discover") {
				const key = JSON.stringify([command.profileId, command.model])
				if (this.discovery?.key !== key) {
					this.discovery = { key, promise: this.discover(command.profileId, command.model) }
				}
				const discovery = this.discovery
				try {
					await reply({ availability: await discovery.promise })
				} finally {
					if (this.discovery === discovery) this.discovery = undefined
				}
				return
			}
			if (command.kind === "approve") {
				if (this.active?.taskId === command.taskId && this.approval?.id === command.approvalId) {
					this.approval.finish(command.allow)
				}
			} else if (command.kind === "answer") {
				const requested = this.active?.question
				if (this.active?.taskId === command.taskId && this.question?.id === command.questionId && requested) {
					const answers = command.answers
					if (
						answers &&
						(Object.keys(answers).length !== requested.questions.length ||
							!requested.questions.every(({ question }) => Object.hasOwn(answers, question)))
					) {
						throw new Error("Answer each question in the current request.")
					}
					this.question.finish(answers)
				}
			} else if (command.kind === "stop") {
				await this.stop(command.taskId)
			} else {
				let handoff: NativeAgentHandoff | undefined
				const execute = async () => {
					if (command.kind === "prepare-continuation") handoff = await this.prepareContinuation(command)
					if (command.kind === "continue") await this.continueTask(command.handoffId, command.text)
					if (command.kind === "cancel-continuation" && this.handoff?.draft.id === command.handoffId)
						this.handoff = undefined
					if (command.kind === "send") await this.send(command)
					if (command.kind === "prefer") await this.prefer(command)
					if (
						(command.kind === "diff" || command.kind === "export-recovery") &&
						this.active?.taskId === command.taskId &&
						this.active.session
					) {
						const workspace = await workspaceIdentity(this.active.session.cwd)
						if (workspace.checkout !== this.active.session.checkout)
							throw new Error("The checkout changed.")
						if (command.kind === "diff") await reviewWorkspace(command.taskId, this.storage, workspace)
						else {
							if (this.run)
								throw new Error("Stop the native turn before exporting its recovery snapshot.")
							await exportRecoveryPoint(command.taskId, this.storage, workspace)
						}
					}
				}
				const action = this.actions.then(execute)
				this.actions = action.catch(() => {})
				await action
				await reply({ handoff })
				return
			}
			await reply({})
		} catch (error) {
			await reply({ error: engineMessage(error) })
		}
	}
}
