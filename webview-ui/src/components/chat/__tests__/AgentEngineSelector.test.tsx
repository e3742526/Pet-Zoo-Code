import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AgentEngineSelector } from "../AgentEngineSelector"

describe("Agent engine selector", () => {
	it("uses a labeled radio group and selects only the available engine", async () => {
		const select = vi.fn()
		render(
			<AgentEngineSelector
				engine="dory"
				onChange={select}
				onRefresh={vi.fn()}
				availability={{ profileId: "p1", engine: "codex", model: "gpt-5.6-sol", selection: "ready" }}
			/>,
		)
		const user = userEvent.setup()
		expect(screen.getByRole("group", { name: "chat:agentEngine.label" })).toBeInTheDocument()
		await user.click(screen.getByText("Codex"))
		expect(select).toHaveBeenCalledWith("codex")
		expect(screen.queryByRole("radio", { name: "Claude Agent" })).not.toBeInTheDocument()
	})

	it("keeps an unavailable remembered preference and explains the setup problem", async () => {
		const refresh = vi.fn()
		render(
			<AgentEngineSelector
				engine="claude-agent"
				onChange={vi.fn()}
				onRefresh={refresh}
				availability={{
					profileId: "p2",
					engine: "claude-agent",
					model: "claude-sonnet-5",
					reason: "Sign in to Claude Code.",
				}}
			/>,
		)
		expect(screen.getByRole("radio", { name: "Claude Agent" })).toBeChecked()
		expect(screen.getByRole("radio", { name: "Claude Agent" })).toBeDisabled()
		expect(screen.getByText(/Sign in to Claude Code/)).toBeVisible()
		await userEvent.click(screen.getByRole("button", { name: "chat:agentEngine.checkSetup" }))
		expect(refresh).toHaveBeenCalledOnce()
	})
})
