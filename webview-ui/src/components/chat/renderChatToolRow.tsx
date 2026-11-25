// Render tool requests and results, with file operations handled by renderChatFileToolRow.
// Extracted from ChatRow.tsx.

import type { ReactNode } from "react"
import type { ChatRowTool } from "./chatRowMessages"
import { Trans } from "react-i18next"
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react"
import { ArrowRight, PocketKnife, Split } from "lucide-react"

import { safeJsonParse } from "@roo/core"
import { vscode } from "@src/utils/vscode"
import { ToolUseBlockHeader } from "../common/ToolUseBlock"
import { TodoChangeDisplay } from "./TodoChangeDisplay"
import MarkdownBlock from "../common/MarkdownBlock"
import { renderChatFileToolRow, type ChatToolRowProps } from "./renderChatFileToolRow"

type ToolRowProps = ChatToolRowProps & {
	linkedChildTaskId?: string
	followedBySubtaskResult?: boolean
	previousTodoUpdate?: string
}

const toolIcon = (name: string) => (
	<span
		className={`codicon codicon-${name}`}
		style={{ color: "var(--vscode-foreground)", marginBottom: "-1.5px" }}></span>
)

export function renderChatToolRow(props: ToolRowProps): ReactNode {
	const {
		message,
		tool,
		headerStyle,
		isExpanded,
		handleToggleExpand,
		t,
		linkedChildTaskId,
		followedBySubtaskResult,
		previousTodoUpdate,
	} = props
	switch (tool.tool as string) {
		case "codebaseSearch": {
			return (
				<div style={headerStyle}>
					{toolIcon("search")}
					<span style={{ fontWeight: "bold" }}>
						{tool.path ? (
							<Trans
								t={t}
								i18nKey="chat:codebaseSearch.wantsToSearchWithPath"
								components={{ code: <code></code> }}
								values={{ query: tool.query, path: tool.path }}
							/>
						) : (
							<Trans
								t={t}
								i18nKey="chat:codebaseSearch.wantsToSearch"
								components={{ code: <code></code> }}
								values={{ query: tool.query }}
							/>
						)}
					</span>
				</div>
			)
		}
		case "updateTodoList": {
			const previousTodos = safeJsonParse<Pick<ChatRowTool, "todos">>(previousTodoUpdate)?.todos

			return <TodoChangeDisplay previousTodos={previousTodos || []} newTodos={tool.todos || []} />
		}
		case "skill": {
			const skillInfo = tool
			return (
				<>
					<div style={headerStyle}>
						{toolIcon("book")}
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask" ? t("chat:skill.wantsToLoad") : t("chat:skill.didLoad")}
						</span>
					</div>
					<div
						style={{
							marginTop: "4px",
							backgroundColor: "var(--vscode-editor-background)",
							border: "1px solid var(--vscode-editorGroup-border)",
							borderRadius: "4px",
							overflow: "hidden",
							cursor: "pointer",
						}}
						onClick={handleToggleExpand}>
						<ToolUseBlockHeader
							className="group"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "10px 12px",
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
								<span style={{ fontWeight: "500", fontSize: "var(--vscode-font-size)" }}>
									{skillInfo.skill}
								</span>
								{skillInfo.source && (
									<VSCodeBadge style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
										{skillInfo.source}
									</VSCodeBadge>
								)}
							</div>
							<span
								className={`codicon codicon-chevron-${isExpanded ? "up" : "down"} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}></span>
						</ToolUseBlockHeader>
						{isExpanded && (skillInfo.args || skillInfo.description) && (
							<div
								style={{
									padding: "12px 16px",
									borderTop: "1px solid var(--vscode-editorGroup-border)",
									display: "flex",
									flexDirection: "column",
									gap: "8px",
								}}>
								{skillInfo.description && (
									<div style={{ color: "var(--vscode-descriptionForeground)" }}>
										{skillInfo.description}
									</div>
								)}
								{skillInfo.args && (
									<div>
										<span style={{ fontWeight: "500" }}>{t("chat:arguments")} </span>
										<span style={{ color: "var(--vscode-descriptionForeground)" }}>
											{skillInfo.args}
										</span>
									</div>
								)}
							</div>
						)}
					</div>
				</>
			)
		}
		case "switchMode":
			return (
				<>
					<div style={headerStyle}>
						<PocketKnife className="w-4 shrink-0" />
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask" ? (
								<>
									{tool.reason ? (
										<Trans
											t={t}
											i18nKey="chat:modes.wantsToSwitchWithReason"
											components={{ code: <code className="font-medium">{tool.mode}</code> }}
											values={{ mode: tool.mode, reason: tool.reason }}
										/>
									) : (
										<Trans
											t={t}
											i18nKey="chat:modes.wantsToSwitch"
											components={{ code: <code className="font-medium">{tool.mode}</code> }}
											values={{ mode: tool.mode }}
										/>
									)}
								</>
							) : (
								<>
									{tool.reason ? (
										<Trans
											t={t}
											i18nKey="chat:modes.didSwitchWithReason"
											components={{ code: <code className="font-medium">{tool.mode}</code> }}
											values={{ mode: tool.mode, reason: tool.reason }}
										/>
									) : (
										<Trans
											t={t}
											i18nKey="chat:modes.didSwitch"
											components={{ code: <code className="font-medium">{tool.mode}</code> }}
											values={{ mode: tool.mode }}
										/>
									)}
								</>
							)}
						</span>
					</div>
				</>
			)
		case "newTask":
			return (
				<>
					<div style={headerStyle}>
						<Split className="size-4" />
						<span style={{ fontWeight: "bold" }}>
							<Trans
								t={t}
								i18nKey="chat:subtasks.wantsToCreate"
								components={{ code: <code>{tool.mode}</code> }}
								values={{ mode: tool.mode }}
							/>
						</span>
					</div>
					<div className="border-l border-muted-foreground/80 ml-2 pl-4 pb-1">
						<MarkdownBlock markdown={tool.content} />
						<div>
							{linkedChildTaskId && !followedBySubtaskResult && (
								<button
									className="cursor-pointer flex gap-1 items-center mt-2 text-vscode-descriptionForeground hover:text-vscode-descriptionForeground hover:underline font-normal"
									onClick={() =>
										vscode.postMessage({ type: "showTaskWithId", text: linkedChildTaskId })
									}>
									{t("chat:subtasks.goToSubtask")}
									<ArrowRight className="size-3" />
								</button>
							)}
						</div>
					</div>
				</>
			)
		case "finishTask":
			return (
				<>
					<div style={headerStyle}>
						{toolIcon("check-all")}
						<span style={{ fontWeight: "bold" }}>{t("chat:subtasks.wantsToFinish")}</span>
					</div>
					<div className="text-muted-foreground pl-6">
						<MarkdownBlock markdown={t("chat:subtasks.completionInstructions")} />
					</div>
				</>
			)
		case "runSlashCommand": {
			const slashCommandInfo = tool
			return (
				<>
					<div style={headerStyle}>
						{toolIcon("play")}
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask" ? t("chat:slashCommand.wantsToRun") : t("chat:slashCommand.didRun")}
						</span>
					</div>
					<div
						style={{
							marginTop: "4px",
							backgroundColor: "var(--vscode-editor-background)",
							border: "1px solid var(--vscode-editorGroup-border)",
							borderRadius: "4px",
							overflow: "hidden",
							cursor: "pointer",
						}}
						onClick={handleToggleExpand}>
						<ToolUseBlockHeader
							className="group"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "10px 12px",
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
								<span style={{ fontWeight: "500", fontSize: "var(--vscode-font-size)" }}>
									/{slashCommandInfo.command}
								</span>
								{slashCommandInfo.source && (
									<VSCodeBadge style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
										{slashCommandInfo.source}
									</VSCodeBadge>
								)}
							</div>
							<span
								className={`codicon codicon-chevron-${isExpanded ? "up" : "down"} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}></span>
						</ToolUseBlockHeader>
						{isExpanded && (slashCommandInfo.args || slashCommandInfo.description) && (
							<div
								style={{
									padding: "12px 16px",
									borderTop: "1px solid var(--vscode-editorGroup-border)",
									display: "flex",
									flexDirection: "column",
									gap: "8px",
								}}>
								{slashCommandInfo.args && (
									<div>
										<span style={{ fontWeight: "500" }}>{t("chat:arguments")} </span>
										<span style={{ color: "var(--vscode-descriptionForeground)" }}>
											{slashCommandInfo.args}
										</span>
									</div>
								)}
								{slashCommandInfo.description && (
									<div style={{ color: "var(--vscode-descriptionForeground)" }}>
										{slashCommandInfo.description}
									</div>
								)}
							</div>
						)}
					</div>
				</>
			)
		}
		default:
			return renderChatFileToolRow(props, toolIcon)
	}
}
