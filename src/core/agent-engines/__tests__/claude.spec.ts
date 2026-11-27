import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk/core"
import { describe, expect, it, vi } from "vitest"

import { openClaude } from "../claude"

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock("@anthropic-ai/claude-agent-sdk/core", () => ({ query }))
vi.mock("../process", async (original) => ({
	...(await original<typeof import("../process")>()),
	installedRuntime: async () => "/local/claude",
	runtimeStatus: async () => ({
		loggedIn: true,
		authMethod: "claude.ai",
		apiProvider: "firstParty",
		email: "test@example.invalid",
		orgId: "org",
	}),
}))

describe("Claude Agent SDK adapter", () => {
	const route = {
		engine: "claude-agent",
		route: "subscription",
		profileId: "p1",
		connection: "Local profile",
		model: "claude-sonnet-5",
		cwd: "/project",
		storage: "/temp",
	} as const

	it("validates the runtime before sending and maps structured input and results", async () => {
		const turn = vi.fn()
		query.mockImplementationOnce(
			({
				prompt,
				options,
			}: {
				prompt: AsyncIterable<SDKUserMessage>
				options: { resume: string; cwd: string }
			}) => ({
				initializationResult: async () => {
					expect(turn).not.toHaveBeenCalled()
					return {
						account: { apiProvider: "firstParty", email: "test@example.invalid" },
						models: [{ resolvedModel: route.model }],
					}
				},
				close: vi.fn(),
				async *[Symbol.asyncIterator]() {
					const input = await prompt[Symbol.asyncIterator]().next()
					turn(input.value)
					expect(options.resume).toBe("native-session")
					yield {
						type: "system",
						subtype: "init",
						session_id: options.resume,
						cwd: options.cwd,
						claude_code_version: "2.1.284",
						model: route.model,
						permissionMode: "default",
						apiKeySource: "none",
					}
					yield {
						type: "assistant",
						session_id: options.resume,
						uuid: "a",
						parent_tool_use_id: null,
						message: {
							content: [
								{ type: "text", text: "Checked the file." },
								{ type: "thinking", thinking: "private" },
							],
						},
					}
					yield {
						type: "result",
						session_id: options.resume,
						subtype: "success",
						is_error: false,
						usage: { input_tokens: 23, output_tokens: 8 },
					}
				},
			}),
		)
		const runtime = await openClaude(route, "native-session")
		try {
			const row = vi.fn()
			const usage = vi.fn()
			const bind = vi.fn(async () => {})
			const result = await runtime.run(
				"native-session",
				"Check this",
				["data:image/png;base64,AA=="],
				{ row, usage, approval: vi.fn(), question: vi.fn(), started: vi.fn(async () => {}) },
				bind,
			)
			expect(result).toBe("completed")
			expect(bind).toHaveBeenCalledExactlyOnceWith("native-session")
			expect(row).toHaveBeenCalledExactlyOnceWith({ id: "a", kind: "assistant", text: "Checked the file." })
			expect(turn).toHaveBeenCalledWith(
				expect.objectContaining({
					session_id: "native-session",
					message: {
						role: "user",
						content: [
							{ type: "text", text: "Check this" },
							{ type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } },
						],
					},
				}),
			)
			expect(usage).toHaveBeenCalledExactlyOnceWith(23, 8)
		} finally {
			await runtime.close()
		}
	})
})
