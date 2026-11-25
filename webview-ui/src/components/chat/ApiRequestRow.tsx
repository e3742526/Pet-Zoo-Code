// Render the API request status, retry details, and rate-limit wait.
// Extracted from ChatRow.tsx.

import type { CSSProperties, ReactNode } from "react"
import { Repeat2 } from "lucide-react"
import type { ClineApiReqInfo, ClineMessage } from "@roo-code/types"

import { cn } from "@/lib/utils"

import ErrorRow from "./ErrorRow"
import { ProgressIndicator } from "./ProgressIndicator"
import type { ChatRowTranslation } from "./chatRowMessages"

type ApiRequestRowProps = {
	message: ClineMessage
	icon: ReactNode
	title: ReactNode
	headerStyle: CSSProperties
	cost: ClineApiReqInfo["cost"]
	apiReqCancelReason: ClineApiReqInfo["cancelReason"]
	apiReqStreamingFailedMessage: ClineApiReqInfo["streamingFailedMessage"]
	apiRequestFailedMessage?: string
	t: ChatRowTranslation
}

export function ApiRequestRow({
	message,
	icon,
	title,
	headerStyle,
	cost,
	apiReqCancelReason,
	apiReqStreamingFailedMessage,
	apiRequestFailedMessage,
	t,
}: ApiRequestRowProps) {
	switch (message.say) {
		case "api_req_started": {
			// Determine if the API request is in progress
			const isApiRequestInProgress =
				apiReqCancelReason === undefined && apiRequestFailedMessage === undefined && cost === undefined

			return (
				<>
					<div
						className={`group text-sm transition-opacity ${
							isApiRequestInProgress ? "opacity-100" : "opacity-40 hover:opacity-100"
						}`}
						style={{
							...headerStyle,
							marginBottom:
								((cost === null || cost === undefined) && apiRequestFailedMessage) ||
								apiReqStreamingFailedMessage
									? 10
									: 0,
							justifyContent: "space-between",
						}}>
						<div style={{ display: "flex", alignItems: "center", gap: "10px", flexGrow: 1 }}>
							{icon}
							{title}
						</div>
						<div
							className="text-xs text-vscode-dropdown-foreground border-vscode-dropdown-border/50 border px-1.5 py-0.5 rounded-lg"
							style={{ opacity: cost !== null && cost !== undefined && cost > 0 ? 1 : 0 }}>
							${Number(cost || 0)?.toFixed(4)}
						</div>
					</div>
					{(((cost === null || cost === undefined) && apiRequestFailedMessage) ||
						apiReqStreamingFailedMessage) && (
						<ErrorRow
							type="api_failure"
							message={apiRequestFailedMessage || apiReqStreamingFailedMessage || ""}
							docsURL={
								apiRequestFailedMessage?.toLowerCase().includes("powershell")
									? "https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22"
									: undefined
							}
							errorDetails={apiReqStreamingFailedMessage}
						/>
					)}
				</>
			)
		}
		case "api_req_retry_delayed": {
			let body = t(`chat:apiRequest.failed`)
			let retryInfo, rawError, code
			if (message.text !== undefined) {
				// Try to show richer error message for that code, if available
				const potentialCode = parseInt(message.text.substring(0, 3))
				if (!isNaN(potentialCode) && potentialCode >= 400) {
					code = potentialCode
					const stringForError = `chat:apiRequest.errorMessage.${code}`
					const errorMessage = t(stringForError, { defaultValue: "" })
					if (errorMessage) {
						body = errorMessage
					}
				}

				// This isn't pretty, but since the retry logic happens at a lower level
				// and the message object is just a flat string, we need to extract the
				// retry information using this "tag" as a convention
				const retryTimerMatch = message.text.match(/<retry_timer>(.*?)<\/retry_timer>/)
				const retryTimer = retryTimerMatch && retryTimerMatch[1] ? parseInt(retryTimerMatch[1], 10) : 0
				rawError = message.text.replace(/<retry_timer>(.*?)<\/retry_timer>/, "").trim()
				retryInfo = retryTimer > 0 && (
					<p
						className={cn(
							"mt-2 font-light text-xs  text-vscode-descriptionForeground cursor-default flex items-center gap-1 transition-all duration-1000",
							retryTimer === 0 ? "opacity-0 max-h-0" : "max-h-2 opacity-100",
						)}>
						<Repeat2 className="size-3" strokeWidth={1.5} />
						<span>{retryTimer}s</span>
					</p>
				)
			}
			return (
				<ErrorRow
					type="api_req_retry_delayed"
					code={code}
					message={body}
					additionalContent={retryInfo}
					errorDetails={rawError}
				/>
			)
		}
		case "api_req_rate_limit_wait": {
			const isWaiting = message.partial === true

			const waitSeconds = (() => {
				if (!message.text) return undefined
				try {
					const data = JSON.parse(message.text)
					return typeof data.seconds === "number" ? data.seconds : undefined
				} catch {
					return undefined
				}
			})()

			return isWaiting && waitSeconds !== undefined ? (
				<div
					className={`group text-sm transition-opacity opacity-100`}
					style={{
						...headerStyle,
						marginBottom: 0,
						justifyContent: "space-between",
					}}>
					<div style={{ display: "flex", alignItems: "center", gap: "10px", flexGrow: 1 }}>
						<ProgressIndicator />
						<span style={{ color: "var(--vscode-foreground)" }}>{t("chat:apiRequest.rateLimitWait")}</span>
					</div>
					<span className="text-xs font-light text-vscode-descriptionForeground">{waitSeconds}s</span>
				</div>
			) : null
		}
		default:
			return null
	}
}
