import { z } from "zod"

export const agentEngineSchema = z.enum(["dory", "codex", "claude-agent"])
export type AgentEngineId = z.infer<typeof agentEngineSchema>
export type NativeEngineId = Exclude<AgentEngineId, "dory">

export const nativeAgentAuthSchema = z.enum(["subscription", "api-key"])
export type NativeAgentAuth = z.infer<typeof nativeAgentAuthSchema>

export const agentEngineProfileSchema = z.object({
	agentEngine: agentEngineSchema.optional(),
	nativeAgentAuth: nativeAgentAuthSchema.optional(),
})

export const nativeAgentSessionSchema = z.object({
	version: z.literal(1),
	engine: z.enum(["codex", "claude-agent"]),
	nativeId: z.string().min(1).optional(),
	profileId: z.string().min(1),
	connection: z.string(),
	accountScope: z.string().min(1),
	route: nativeAgentAuthSchema,
	model: z.string().min(1),
	cwd: z.string().min(1),
	checkout: z.string().min(1),
	host: z.string().min(1),
	runtime: z.string().min(1),
	imagesSupported: z.boolean().optional(),
	createdAt: z.number(),
})
export type NativeAgentSession = z.infer<typeof nativeAgentSessionSchema>

export type NativeAgentAvailability = {
	profileId: string
	model: string
	engine: NativeEngineId
	route?: NativeAgentAuth
	connection?: string
	runtime?: string
	images?: boolean
	reason?: string
	selection?: string
}

export type NativeAgentRow = {
	id: string
	kind: "user" | "assistant" | "action" | "notice"
	text: string
}

export type NativeAgentQuestion = {
	question: string
	options: { label: string; description: string }[]
	multiSelect?: boolean
}

export type NativeAgentApproval = {
	id: string
	operation: string
	detail: string
}

export type NativeAgentView = {
	taskId: string
	engine: string
	session?: NativeAgentSession
	status:
		| "idle"
		| "starting"
		| "running"
		| "approval"
		| "input"
		| "stopping"
		| "stopped"
		| "failed"
		| "disconnected"
		| "turn-completed"
		| "unsupported"
	rows: NativeAgentRow[]
	approval?: NativeAgentApproval
	question?: { id: string; questions: NativeAgentQuestion[] }
	error?: string
	usage?: { input: number; output: number }
	canSendImages?: boolean
}

export type NativeAgentHandoff = {
	id: string
	engine: AgentEngineId
	model: string
	connection: string
	route?: NativeAgentAuth
	cwd: string
	text: string
}

export const nativeAgentCommandSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("discover"), profileId: z.string(), model: z.string() }),
	z.object({
		kind: z.literal("prefer"),
		profileId: z.string(),
		model: z.string(),
		engine: agentEngineSchema,
		selection: z.string().optional(),
	}),
	z.object({
		kind: z.literal("send"),
		profileId: z.string().optional(),
		model: z.string().optional(),
		selection: z.string().optional(),
		taskId: z.string().optional(),
		text: z.string().max(100_000),
		images: z.array(z.string().max(8_000_000)).max(4),
		hasAttachments: z.boolean(),
	}),
	z.object({
		kind: z.literal("prepare-continuation"),
		taskId: z.string(),
		engine: agentEngineSchema,
		profileId: z.string(),
		model: z.string(),
	}),
	z.object({ kind: z.literal("continue"), handoffId: z.string(), text: z.string().trim().min(1).max(100_000) }),
	z.object({ kind: z.literal("stop"), taskId: z.string() }),
	z.object({ kind: z.literal("approve"), taskId: z.string(), approvalId: z.string(), allow: z.boolean() }),
	z.object({
		kind: z.literal("answer"),
		taskId: z.string(),
		questionId: z.string(),
		answers: z.record(z.string().max(1000), z.string().trim().min(1).max(2000)).optional(),
	}),
	z.object({ kind: z.literal("diff"), taskId: z.string() }),
	z.object({ kind: z.literal("export-recovery"), taskId: z.string() }),
	z.object({ kind: z.literal("cancel-continuation"), handoffId: z.string() }),
])
export type NativeAgentCommand = z.infer<typeof nativeAgentCommandSchema>
