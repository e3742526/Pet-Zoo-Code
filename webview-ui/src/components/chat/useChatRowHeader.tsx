// Build and memoize the header for the active chat message type.
// Extracted from ChatRow.tsx.

import { useMemo } from "react"
import { MessageCircleQuestionMark, OctagonX, SquareTerminal } from "lucide-react"
import type { ClineApiReqInfo, ClineAskUseMcpServer, ClineMessage } from "@roo-code/types"

import { safeJsonParse } from "@roo/core"

import { ProgressIndicator } from "./ProgressIndicator"
import type { ChatRowTranslation } from "./chatRowMessages"

type ChatRowHeaderProps = {
	message: ClineMessage
	isCommandExecuting?: boolean
	isMcpServerResponding: boolean
	apiReqCancelReason: ClineApiReqInfo["cancelReason"]
	cost: ClineApiReqInfo["cost"]
	apiRequestFailedMessage?: string
	t: ChatRowTranslation
	isLast: boolean
}

export function useChatRowHeader({
	message,
	isCommandExecuting,
	isMcpServerResponding,
	apiReqCancelReason,
	cost,
	apiRequestFailedMessage,
	t,
	isLast,
}: ChatRowHeaderProps) {
	const type = message.type === "ask" ? message.ask : message.say

	const normalColor = "var(--vscode-foreground)"
	const errorColor = "var(--vscode-errorForeground)"
	const successColor = "var(--vscode-charts-green)"
	const cancelledColor = "var(--vscode-descriptionForeground)"

	return useMemo(() => {
		switch (type) {
			case "error":
			case "mistake_limit_reached":
				return { icon: null, title: null } // These will be handled by ErrorRow component
			case "command":
				if (message.autoApprovalDecision === "deny") {
					return {
						icon: <OctagonX key="denied-icon" className="size-4 text-vscode-errorForeground" />,
						title: (
							<span key="denied-title" className="font-bold text-vscode-errorForeground">
								{t("chat:commandExecution.denied")}
							</span>
						),
					}
				}
				return {
					icon: isCommandExecuting ? <ProgressIndicator /> : <SquareTerminal className="size-4" />,
					title: (
						<span style={{ color: normalColor, fontWeight: "bold" }}>
							{t("chat:commandExecution.running")}
						</span>
					),
				}
			case "use_mcp_server": {
				const mcpServerUse = safeJsonParse<ClineAskUseMcpServer>(message.text)
				if (mcpServerUse === undefined) {
					return { icon: null, title: null }
				}
				return {
					icon: isMcpServerResponding ? (
						<ProgressIndicator />
					) : (
						<span
							className="codicon codicon-server"
							style={{ color: normalColor, marginBottom: "-1.5px" }}></span>
					),
					title: (
						<span style={{ color: normalColor, fontWeight: "bold" }}>
							{mcpServerUse.type === "use_mcp_tool"
								? t("chat:mcp.wantsToUseTool", { serverName: mcpServerUse.serverName })
								: t("chat:mcp.wantsToAccessResource", { serverName: mcpServerUse.serverName })}
						</span>
					),
				}
			}
			case "completion_result":
				return {
					icon: (
						<span
							className="codicon codicon-check"
							style={{ color: successColor, marginBottom: "-1.5px" }}></span>
					),
					title: <span style={{ color: successColor, fontWeight: "bold" }}>{t("chat:taskCompleted")}</span>,
				}
			case "api_req_rate_limit_wait":
				return { icon: undefined, title: undefined }
			case "api_req_retry_delayed":
				return { icon: undefined, title: undefined }
			case "api_req_started": {
				const getIconSpan = (iconName: string, color: string) => (
					<div
						style={{
							width: 16,
							height: 16,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}>
						<span
							className={`codicon codicon-${iconName}`}
							style={{ color, fontSize: 16, marginBottom: "-1.5px" }}
						/>
					</div>
				)
				return {
					icon:
						apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
							apiReqCancelReason === "user_cancelled" ? (
								getIconSpan("error", cancelledColor)
							) : (
								getIconSpan("error", errorColor)
							)
						) : cost !== null && cost !== undefined ? (
							getIconSpan("arrow-swap", normalColor)
						) : apiRequestFailedMessage ? (
							getIconSpan("error", errorColor)
						) : isLast ? (
							<ProgressIndicator />
						) : (
							getIconSpan("arrow-swap", normalColor)
						),
					title:
						apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
							apiReqCancelReason === "user_cancelled" ? (
								<span style={{ color: normalColor, fontWeight: "bold" }}>
									{t("chat:apiRequest.cancelled")}
								</span>
							) : (
								<span style={{ color: errorColor, fontWeight: "bold" }}>
									{t("chat:apiRequest.streamingFailed")}
								</span>
							)
						) : cost !== null && cost !== undefined ? (
							<span style={{ color: normalColor }}>{t("chat:apiRequest.title")}</span>
						) : apiRequestFailedMessage ? (
							<span style={{ color: errorColor }}>{t("chat:apiRequest.failed")}</span>
						) : (
							<span style={{ color: normalColor }}>{t("chat:apiRequest.streaming")}</span>
						),
				}
			}
			case "followup":
				return {
					icon: <MessageCircleQuestionMark className="w-4 shrink-0" />,
					title: (
						<span style={{ color: normalColor, fontWeight: "bold" }}>
							{t("chat:questions.hasQuestion")}
						</span>
					),
				}
			default:
				return { icon: null, title: null }
		}
	}, [
		type,
		isCommandExecuting,
		message,
		isMcpServerResponding,
		apiReqCancelReason,
		cost,
		apiRequestFailedMessage,
		t,
		isLast,
	])
}
