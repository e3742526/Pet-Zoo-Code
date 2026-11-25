import { ORGANIZATION_ALLOW_ALL, providerIdentifiers } from "@roo-code/types"

import { type CliProcessItem, runJsonlProcess } from "../../../api/providers/cli-subscription/process"
import { singleCompletionHandler } from "../../../utils/single-completion-handler"
import { draftCommitMessage, type CommitProfile } from "../providers"

vi.mock("vscode", () => ({
	workspace: { getConfiguration: () => ({ inspect: () => undefined }) },
}))
vi.mock("../../../integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: { isAuthenticated: () => Promise.resolve(true) },
}))
vi.mock("../../../integrations/kimi-code/oauth", () => ({
	kimiCodeOAuthManager: { isAuthenticated: () => Promise.resolve(false) },
}))
vi.mock("../../../api/providers/github-copilot", () => ({
	getGitHubCopilotAccount: () => Promise.resolve(undefined),
}))
vi.mock("../../../api/providers/qwen-code", () => ({
	hasQwenCredentials: () => Promise.resolve(false),
}))
vi.mock("../../../api/providers/cli-subscription/executable", () => ({
	resolveCliExecutable: () => Promise.resolve("/usr/local/bin/dory"),
	getCliSearchDirectories: () => ["/usr/local/bin"],
}))
vi.mock("../../../api/providers/cli-subscription/process", () => ({
	buildCliEnvironment: () => ({}),
	runJsonlProcess: vi.fn(),
}))
vi.mock("../../../utils/single-completion-handler", () => ({ singleCompletionHandler: vi.fn() }))

const complete = vi.mocked(singleCompletionHandler)
const dory = vi.mocked(runJsonlProcess)
const MESSAGE = "feat: draft commit messages"
const { anthropic, openaiCodex, antigravity, museCode, kimiCode } = providerIdentifiers
const profiles: CommitProfile[] = [
	{ id: "key", settings: { apiProvider: anthropic, apiKey: "test-key" } },
	{ id: "agy", settings: { apiProvider: antigravity } },
	{ id: "kimi-key", settings: { apiProvider: kimiCode, kimiCodeAuthMethod: "api-key", kimiCodeApiKey: "test-key" } },
]

function draft(overrides: Partial<Parameters<typeof draftCommitMessage>[0]> = {}) {
	return draftCommitMessage({
		selection: "default",
		profiles,
		allowList: ORGANIZATION_ALLOW_ALL,
		patch: "+feature",
		cwd: "/repo",
		signal: new AbortController().signal,
		beforeDory: async () => true,
		log: vi.fn(),
		...overrides,
	})
}

function doryResponse(exitCode: number, message?: string) {
	return async function* (): AsyncGenerator<CliProcessItem> {
		if (message) yield { type: "event", value: { success: true, stdout: message } }
		yield { type: "exit", exitCode, signal: null, stderr: "", nonJsonLines: [] }
	}
}

beforeEach(() => {
	complete.mockReset()
	dory.mockReset()
})

it("falls back from signed-in services to CLI agents and then to configured APIs", async () => {
	const attempts: string[] = []
	complete.mockImplementation(async ({ apiProvider }) => {
		attempts.push(apiProvider ?? "")
		if (apiProvider === openaiCodex) return "Here is the commit message:"
		if (apiProvider === kimiCode) return MESSAGE
		throw new Error("Unavailable")
	})
	dory.mockImplementation(async function* () {
		attempts.push("dory")
		yield* doryResponse(1)()
	})

	await expect(draft()).resolves.toBe(MESSAGE)
	expect(attempts).toEqual([openaiCodex, antigravity, museCode, "dory", anthropic, kimiCode])
})

it("uses a successful signed-in service without starting the CLI wrapper or an API request", async () => {
	complete.mockResolvedValue(MESSAGE)
	await expect(draft()).resolves.toBe(MESSAGE)
	expect(complete).toHaveBeenCalledTimes(1)
	expect(complete.mock.calls[0][0].apiProvider).toBe(openaiCodex)
	expect(dory).not.toHaveBeenCalled()
})

it("uses the Dory wrapper before API profiles", async () => {
	complete.mockRejectedValue(new Error("Unavailable"))
	dory.mockImplementation(doryResponse(0, MESSAGE))

	await expect(draft()).resolves.toBe(MESSAGE)
	expect(dory).toHaveBeenCalledWith(
		expect.objectContaining({
			args: ["session", "draft-commit", "--provider", "auto", "--dry-run", "--json"],
			cwd: "/repo",
		}),
	)
	expect(complete.mock.calls.map(([profile]) => profile.apiProvider)).toEqual([openaiCodex, antigravity, museCode])
})

it("uses only the selected profile when it fails", async () => {
	complete.mockRejectedValue(new Error("Unavailable"))
	await expect(draft({ selection: "profile:key" })).resolves.toBeUndefined()
	expect(complete).toHaveBeenCalledTimes(1)
	expect(complete.mock.calls[0][0].apiProvider).toBe(anthropic)
	expect(dory).not.toHaveBeenCalled()
})

it("pins a selected Dory provider and disables cloud fallback for oMLX", async () => {
	dory.mockImplementation(doryResponse(0, MESSAGE))
	await expect(draft({ selection: "dory:omlx" })).resolves.toBe(MESSAGE)
	expect(dory).toHaveBeenCalledWith(
		expect.objectContaining({ args: expect.arrayContaining(["omlx", "--no-fallback"]) }),
	)
	expect(complete).not.toHaveBeenCalled()
})

it("skips disallowed providers, including the Dory wrapper, under an organization allowlist", async () => {
	complete.mockResolvedValue(MESSAGE)
	await expect(draft({ allowList: { allowAll: false, providers: { anthropic: { allowAll: true } } } })).resolves.toBe(
		MESSAGE,
	)
	expect(complete).toHaveBeenCalledTimes(1)
	expect(complete.mock.calls[0][0].apiProvider).toBe(anthropic)
	expect(dory).not.toHaveBeenCalled()
})

it("stops after cancellation without issuing another request", async () => {
	const controller = new AbortController()
	complete.mockImplementation(async () => {
		controller.abort()
		return MESSAGE
	})
	await expect(draft({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
	expect(complete).toHaveBeenCalledTimes(1)
	expect(dory).not.toHaveBeenCalled()
})
