import type { NativeAgentAuth, NativeAgentQuestion, NativeAgentRow, NativeEngineId } from "@roo-code/types"

export type AgentRoute = {
	engine: NativeEngineId
	route: NativeAgentAuth
	profileId: string
	connection: string
	model: string
	cwd: string
	storage: string
	apiKey?: string
}

export type RuntimeIdentity = {
	accountScope: string
	version: string
	images: boolean
}

export type NativeOutput = {
	started: () => Promise<void>
	row: (row: NativeAgentRow, append?: boolean) => void
	approval: (operation: string, detail: string) => Promise<boolean>
	question: (questions: NativeAgentQuestion[]) => Promise<Record<string, string> | undefined>
	usage: (input: number, output: number) => void
}

export type NativeRuntime = {
	identity: RuntimeIdentity
	run: (
		nativeId: string | undefined,
		text: string,
		images: string[],
		output: NativeOutput,
		bind: (nativeId: string) => Promise<void>,
	) => Promise<"completed" | "interrupted">
	stop: () => Promise<void>
	close: () => Promise<void>
}
