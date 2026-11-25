// Render legacy tool result messages stored in the chat transcript.
// Extracted from ChatRow.tsx.

import type { CSSProperties } from "react"
import type { ClineMessage, ClineSayTool } from "@roo-code/types"
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react"
import { FileCode2 } from "lucide-react"

import { safeJsonParse } from "@roo/core"

import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock"
import type { ChatRowTranslation } from "./chatRowMessages"

type ToolResultRowProps = {
	message: ClineMessage
	headerStyle: CSSProperties
	t: ChatRowTranslation
}

export function ToolResultRow({ message, headerStyle, t }: ToolResultRowProps) {
	// Handle say tool messages
	const sayTool = safeJsonParse<ClineSayTool>(message.text)
	if (!sayTool) return null

	switch (sayTool.tool) {
		case "runSlashCommand": {
			const slashCommandInfo = sayTool
			return (
				<>
					<div style={headerStyle}>
						<span
							className="codicon codicon-terminal-cmd"
							style={{
								color: "var(--vscode-foreground)",
								marginBottom: "-1.5px",
							}}></span>
						<span style={{ fontWeight: "bold" }}>{t("chat:slashCommand.didRun")}</span>
					</div>
					<div className="pl-6">
						<ToolUseBlock>
							<ToolUseBlockHeader
								style={{
									display: "flex",
									flexDirection: "column",
									alignItems: "flex-start",
									gap: "4px",
									padding: "10px 12px",
								}}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "8px",
										width: "100%",
									}}>
									<span
										style={{
											fontWeight: "500",
											fontSize: "var(--vscode-font-size)",
										}}>
										/{slashCommandInfo.command}
									</span>
									{slashCommandInfo.args && (
										<span
											style={{
												color: "var(--vscode-descriptionForeground)",
												fontSize: "var(--vscode-font-size)",
											}}>
											{slashCommandInfo.args}
										</span>
									)}
								</div>
								{slashCommandInfo.description && (
									<div
										style={{
											color: "var(--vscode-descriptionForeground)",
											fontSize: "calc(var(--vscode-font-size) - 1px)",
										}}>
										{slashCommandInfo.description}
									</div>
								)}
								{slashCommandInfo.source && (
									<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
										<VSCodeBadge style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
											{slashCommandInfo.source}
										</VSCodeBadge>
									</div>
								)}
							</ToolUseBlockHeader>
						</ToolUseBlock>
					</div>
				</>
			)
		}
		case "readCommandOutput": {
			const formatBytes = (bytes: number) => {
				if (bytes < 1024) return `${bytes} B`
				if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
				return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
			}

			// Determine if this is a search operation
			const isSearch = sayTool.searchPattern !== undefined

			let infoText = ""
			if (isSearch) {
				// Search mode: show pattern and match count
				const matchText =
					sayTool.matchCount !== undefined
						? sayTool.matchCount === 1
							? "1 match"
							: `${sayTool.matchCount} matches`
						: ""
				infoText = `search: "${sayTool.searchPattern}"${matchText ? ` • ${matchText}` : ""}`
			} else if (
				sayTool.readStart !== undefined &&
				sayTool.readEnd !== undefined &&
				sayTool.totalBytes !== undefined
			) {
				// Read mode: show byte range
				infoText = `${formatBytes(sayTool.readStart)} - ${formatBytes(sayTool.readEnd)} of ${formatBytes(sayTool.totalBytes)}`
			} else if (sayTool.totalBytes !== undefined) {
				infoText = formatBytes(sayTool.totalBytes)
			}

			return (
				<div style={headerStyle}>
					<FileCode2 className="w-4 shrink-0" />
					<span style={{ fontWeight: "bold" }}>{t("chat:readCommandOutput.title")}</span>
					{infoText && (
						<span className="text-xs ml-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
							({infoText})
						</span>
					)}
				</div>
			)
		}
		default:
			return null
	}
}
