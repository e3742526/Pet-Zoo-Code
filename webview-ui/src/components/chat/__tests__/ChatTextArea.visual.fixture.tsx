import React, { useState } from "react"

import { providerIdentifiers } from "@roo-code/types"
import { defaultModeSlug, type Mode } from "@roo/modes"
import { AppProviders } from "../../../../playwright/AppProviders"
import { AgentEngineSelector } from "../AgentEngineSelector"
import { ChatTextArea } from "../ChatTextArea"

export function ChatTextAreaStory({
	withRepositoryPrompts = false,
	withAgentEngine = false,
}: {
	withRepositoryPrompts?: boolean
	withAgentEngine?: boolean
}) {
	const [inputValue, setInputValue] = useState("Audit contrast across the Zoo Code webview")
	const [selectedImages, setSelectedImages] = useState<string[]>([])
	const [engine, setEngine] = useState<"dory" | "codex" | "claude-agent">("codex")
	const [mode, setMode] = useState<Mode>(defaultModeSlug)

	return (
		<AppProviders
			initialState={{
				cwd: "/workspace/project",
				...(withAgentEngine && {
					currentApiConfigName: "Personal profile",
					apiConfiguration: { apiProvider: providerIdentifiers.openaiCodex, apiModelId: "gpt-5.6-sol" },
					listApiConfigMeta: [
						{ id: "codex", name: "Personal profile", apiProvider: providerIdentifiers.openaiCodex },
					],
				}),
				repoPromptShortcuts: withRepositoryPrompts
					? [{ id: "build", name: "Build repository", text: "Build this repository" }]
					: [],
			}}>
			<div
				data-testid="chat-text-area-story"
				className="w-[488px] max-w-full rounded-lg border border-vscode-panel-border bg-vscode-editor-background p-3">
				<ChatTextArea
					nativeEngine={withAgentEngine && engine !== "dory"}
					agentEngineControl={
						withAgentEngine && (
							<AgentEngineSelector
								engine={engine}
								onChange={setEngine}
								onRefresh={() => undefined}
								availability={{
									profileId: "codex",
									engine: "codex",
									route: "subscription",
									connection: "Personal profile",
									model: "gpt-5.6-sol",
									selection: "ready",
								}}
							/>
						)
					}
					inputValue={inputValue}
					setInputValue={setInputValue}
					sendingDisabled={false}
					selectApiConfigDisabled={false}
					placeholderText="Type a message"
					selectedImages={selectedImages}
					setSelectedImages={setSelectedImages}
					onSend={() => undefined}
					onSelectImages={() => undefined}
					shouldDisableImages={false}
					mode={mode}
					setMode={setMode}
					modeShortcutText="Ctrl+. for next mode"
				/>
			</div>
		</AppProviders>
	)
}
