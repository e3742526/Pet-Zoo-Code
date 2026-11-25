// Compatibility facade for chat rows, transcript subscriptions, and row height updates.
import React, { memo, useCallback, useEffect, useMemo, useRef } from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import deepEqual from "fast-deep-equal"

import type {
	ClineMessage,
	FollowUpData,
	SuggestionItem,
	ClineApiReqInfo,
	ClineAskUseMcpServer,
	ClineSayTool,
	CompletionCheckpoint,
} from "@roo-code/types"

import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { safeJsonParse } from "@roo/core"

import { useExtensionChatRowState, useExtensionState } from "@src/context/ExtensionStateContext"
import { findMatchingResourceOrTemplate } from "@src/utils/mcp"
import { vscode } from "@src/utils/vscode"

import UpdateTodoListToolBlock from "./UpdateTodoListToolBlock"
import CodeAccordion from "../common/CodeAccordion"
import MarkdownBlock from "../common/MarkdownBlock"
import { ReasoningBlock } from "./ReasoningBlock"
import ImageBlock from "../common/ImageBlock"
import ErrorRow from "./ErrorRow"
import WarningRow from "./WarningRow"

import McpResourceRow from "../mcp/McpResourceRow"

import { isShowableTimestamp, MessageTimestamp } from "./MessageTimestamp"
import { CheckpointSaved } from "./checkpoints/CheckpointSaved"
import { FollowUpSuggest } from "./FollowUpSuggest"
import { Markdown } from "./Markdown"
import { CommandExecution } from "./CommandExecution"
import { CommandExecutionError } from "./CommandExecutionError"
import { AutoApprovedRequestLimitWarning } from "./AutoApprovedRequestLimitWarning"
import { InProgressRow, CondensationResultRow, CondensationErrorRow, TruncationResultRow } from "./context-management"
import CodebaseSearchResultsDisplay from "./CodebaseSearchResultsDisplay"
import { McpExecution } from "./McpExecution"
import { MessageCircle, ArrowRight, Check } from "lucide-react"
import { OpenMarkdownPreviewButton } from "./OpenMarkdownPreviewButton"
import { SeeNewChangesButtons } from "./SeeNewChangesButtons"

import { ApiRequestRow } from "./ApiRequestRow"
import { ToolResultRow } from "./ToolResultRow"
import { UserFeedbackRow } from "./UserFeedbackRow"
import { findPreviousTodoUpdate, getLinkedChildTaskId, type ChatRowTool } from "./chatRowMessages"
import { renderChatToolRow } from "./renderChatToolRow"
import { useChatRowHeader } from "./useChatRowHeader"

interface ChatRowProps {
	message: ClineMessage
	lastModifiedMessage?: ClineMessage
	isExpanded: boolean
	isLast: boolean
	isStreaming: boolean
	onToggleExpand: (ts: number) => void
	onHeightChange: (isTaller: boolean) => void
	onSuggestionClick?: (suggestion: SuggestionItem, event?: React.MouseEvent) => void
	onBatchFileResponse?: (response: { [key: string]: boolean }) => void
	onFollowUpUnmount?: () => void
	isFollowUpAnswered?: boolean
	isFollowUpAutoApprovalPaused?: boolean
	completionCheckpoint?: CompletionCheckpoint
	onJumpToPreviousCheckpoint?: () => void
}

type ChatRowContentProps = Omit<ChatRowProps, "onHeightChange">

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange } = props
		const rowRef = useRef<HTMLDivElement>(null)
		const previousHeight = useRef(0)

		useEffect(() => {
			const row = rowRef.current
			if (!isLast || !row) return

			const observer = new ResizeObserver(() => {
				const height = row.offsetHeight
				const before = previousHeight.current
				if (height === 0 || height === before) return
				previousHeight.current = height
				// The list already scrolls when it adds a row. Report changes after the first measurement.
				if (before > 0) onHeightChange(height > before)
			})
			observer.observe(row, { box: "border-box" })
			return () => observer.disconnect()
		}, [isLast, onHeightChange])

		return (
			<div ref={rowRef} className="relative px-[15px] py-[10px] pr-[6px]">
				<ChatRowContent {...props} />
			</div>
		)
	},
	// memo does shallow comparison of props, so we need to do deep comparison of arrays/objects whose properties might change
	deepEqual,
)

export default ChatRow

export const ChatRowContent = (props: ChatRowContentProps) => {
	const { message } = props
	const { mcpServers, alwaysAllowMcp, currentCheckpoint, mode, enableCheckpoints, timeFormat, dateFormat } =
		useExtensionChatRowState()
	const tool = useMemo(
		() => (message.ask === "tool" ? safeJsonParse<ChatRowTool>(message.text) : null),
		[message.ask, message.text],
	)
	const isMcpRequest = message.type === "ask" && message.ask === "use_mcp_server"
	const RowBody =
		message.say === "subtask_result" || tool?.tool === "newTask" || tool?.tool === "updateTodoList"
			? ChatRowWithTranscript
			: ChatRowBody

	return (
		<RowBody
			{...props}
			tool={tool}
			mcpServers={isMcpRequest ? mcpServers : undefined}
			alwaysAllowMcp={isMcpRequest ? alwaysAllowMcp : undefined}
			currentCheckpoint={message.say === "checkpoint_saved" ? currentCheckpoint : undefined}
			mode={mode}
			enableCheckpoints={enableCheckpoints}
			timeFormat={timeFormat}
			dateFormat={dateFormat}
		/>
	)
}

function ChatRowWithTranscript(props: ChatRowBodyProps) {
	const { clineMessages, currentTaskItem } = useExtensionState()
	const { message, tool } = props
	const isResult = message.type === "say" && message.say === "subtask_result"
	if (!isResult && tool?.tool === "updateTodoList") {
		return <ChatRowBody {...props} previousTodoUpdate={findPreviousTodoUpdate(clineMessages, message.ts)} />
	}

	const linkedChildTaskId = getLinkedChildTaskId(
		message,
		clineMessages,
		currentTaskItem?.childIds ?? [],
		isResult ? currentTaskItem?.completedByChildId : undefined,
	)
	const rowIndex = isResult ? -1 : clineMessages.findIndex((candidate) => candidate.ts === message.ts)
	const nextMessage = rowIndex >= 0 ? clineMessages[rowIndex + 1] : undefined
	return (
		<ChatRowBody
			{...props}
			linkedChildTaskId={linkedChildTaskId}
			followedBySubtaskResult={nextMessage?.type === "say" && nextMessage.say === "subtask_result"}
		/>
	)
}

type ChatRowBodyProps = ChatRowContentProps &
	Omit<ReturnType<typeof useExtensionChatRowState>, "mcpServers"> & {
		tool: ChatRowTool | null | undefined
		linkedChildTaskId?: string
		followedBySubtaskResult?: boolean
		previousTodoUpdate?: string
		mcpServers?: ReturnType<typeof useExtensionChatRowState>["mcpServers"]
	}

const ChatRowBody = memo(function ChatRowBody({
	message,
	lastModifiedMessage,
	isExpanded,
	isLast,
	isStreaming,
	onToggleExpand,
	onSuggestionClick,
	onFollowUpUnmount,
	onBatchFileResponse,
	isFollowUpAnswered,
	isFollowUpAutoApprovalPaused,
	completionCheckpoint,
	onJumpToPreviousCheckpoint,
	tool,
	linkedChildTaskId,
	followedBySubtaskResult,
	previousTodoUpdate,
	mcpServers,
	alwaysAllowMcp,
	currentCheckpoint,
	mode,
	enableCheckpoints,
	timeFormat,
	dateFormat,
}: ChatRowBodyProps) {
	const { t } = useAppTranslation()
	// Memoized callback to prevent re-renders caused by inline arrow functions.
	const handleToggleExpand = useCallback(() => {
		onToggleExpand(message.ts)
	}, [onToggleExpand, message.ts])

	const [cost, apiReqCancelReason, apiReqStreamingFailedMessage] = useMemo(() => {
		if (message.text !== null && message.text !== undefined && message.say === "api_req_started") {
			const info = safeJsonParse<ClineApiReqInfo>(message.text)
			return [info?.cost, info?.cancelReason, info?.streamingFailedMessage]
		}

		return [undefined, undefined, undefined]
	}, [message.text, message.say])

	// When resuming task, last won't be api_req_failed but a resume_task
	// message, so api_req_started will show loading spinner. That's why we just
	// remove the last api_req_started that failed without streaming anything.
	const apiRequestFailedMessage =
		isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
			? lastModifiedMessage?.text
			: undefined

	const isCommandExecuting =
		isLast && lastModifiedMessage?.ask === "command" && lastModifiedMessage?.text?.includes(COMMAND_OUTPUT_STRING)

	const isMcpServerResponding = isLast && lastModifiedMessage?.say === "mcp_server_request_started"

	const { icon, title } = useChatRowHeader({
		message,
		isCommandExecuting,
		isMcpServerResponding,
		apiReqCancelReason,
		cost,
		apiRequestFailedMessage,
		t,
		isLast,
	})

	const headerStyle: React.CSSProperties = {
		display: "flex",
		alignItems: "center",
		gap: "10px",
		cursor: "default",
		marginBottom: "10px",
		wordBreak: "break-word",
	}

	// Unified diff content (provided by backend when relevant)
	const unifiedDiff = useMemo(() => {
		if (!tool) return undefined
		return (tool.content ?? tool.diff) as string | undefined
	}, [tool])

	const onJumpToCreatedFile = useMemo(() => {
		if (!tool || tool.tool !== "newFileCreated" || !tool.path) {
			return undefined
		}

		return () => vscode.postMessage({ type: "openFile", text: "./" + tool.path })
	}, [tool])

	const followUpData = useMemo(() => {
		if (message.type === "ask" && message.ask === "followup" && !message.partial) {
			return safeJsonParse<FollowUpData>(message.text)
		}
		return null
	}, [message.type, message.ask, message.partial, message.text])

	if (tool) {
		return renderChatToolRow({
			message,
			tool,
			headerStyle,
			isExpanded,
			handleToggleExpand,
			onBatchFileResponse,
			unifiedDiff,
			onJumpToCreatedFile,
			t,
			linkedChildTaskId,
			followedBySubtaskResult,
			previousTodoUpdate,
		})
	}

	switch (message.type) {
		case "say":
			// Legacy transcripts can include tool results as say messages.
			switch (message.say as ClineMessage["say"] | "tool") {
				case "diff_error":
					return (
						<ErrorRow
							type="diff_error"
							message={message.text || ""}
							expandable={true}
							showCopyButton={true}
						/>
					)
				case "subtask_result": {
					return (
						<div className="border-l border-muted-foreground/80 ml-2 pl-4 pt-2 pb-1 -mt-5">
							<div style={headerStyle}>
								<span style={{ fontWeight: "bold" }}>{t("chat:subtasks.resultContent")}</span>
								<Check className="size-3" />
							</div>
							<MarkdownBlock markdown={message.text} />
							{linkedChildTaskId && (
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
					)
				}
				case "reasoning":
					return (
						<ReasoningBlock
							content={message.text || ""}
							ts={message.ts}
							isStreaming={isStreaming}
							isLast={isLast}
							partial={message.partial}
						/>
					)

				case "api_req_started":
				case "api_req_retry_delayed":
				case "api_req_rate_limit_wait":
					return (
						<ApiRequestRow
							message={message}
							icon={icon}
							title={title}
							headerStyle={headerStyle}
							cost={cost}
							apiReqCancelReason={apiReqCancelReason}
							apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
							apiRequestFailedMessage={apiRequestFailedMessage}
							t={t}
						/>
					)
				case "api_req_finished":
					return null // we should never see this message type
				case "text":
					return (
						<div className="group">
							<div style={headerStyle}>
								<MessageCircle className="w-4 shrink-0" />
								<span style={{ fontWeight: "bold" }}>{t("chat:text.rooSaid")}</span>
								<div style={{ flexGrow: 1 }} />
								<OpenMarkdownPreviewButton markdown={message.text} />
							</div>
							<div className="pl-6">
								<Markdown markdown={message.text} partial={message.partial} />
								{message.images && message.images.length > 0 && (
									<div style={{ marginTop: "10px" }}>
										{message.images.map((image, index) => (
											<ImageBlock key={index} imageData={image} />
										))}
									</div>
								)}
							</div>
							{/* When the reply was sent. Held back while it streams, so the line does not appear and
							    shift as the text grows. */}
							{!message.partial && isShowableTimestamp(message.ts) && (
								<div className="ml-6 mt-1">
									<MessageTimestamp ts={message.ts} timeFormat={timeFormat} dateFormat={dateFormat} />
								</div>
							)}
						</div>
					)

				case "user_feedback":
					return (
						<UserFeedbackRow
							message={message}
							mode={mode}
							isStreaming={isStreaming}
							headerStyle={headerStyle}
							timeFormat={timeFormat}
							dateFormat={dateFormat}
						/>
					)
				case "user_feedback_diff": {
					const tool = safeJsonParse<ClineSayTool>(message.text)
					return (
						<div style={{ marginTop: -10, width: "100%" }}>
							<CodeAccordion
								code={tool?.diff}
								language="diff"
								isFeedback={true}
								isExpanded={isExpanded}
								onToggleExpand={handleToggleExpand}
							/>
						</div>
					)
				}
				case "error": {
					// Check if this is a model response error based on marker strings from backend
					const isNoToolsUsedError = message.text === "MODEL_NO_TOOLS_USED"
					const isNoAssistantMessagesError = message.text === "MODEL_NO_ASSISTANT_MESSAGES"

					if (isNoToolsUsedError) {
						return (
							<ErrorRow
								type="error"
								title={t("chat:modelResponseIncomplete")}
								message={t("chat:modelResponseErrors.noToolsUsed")}
								errorDetails={t("chat:modelResponseErrors.noToolsUsedDetails")}
							/>
						)
					}

					if (isNoAssistantMessagesError) {
						return (
							<ErrorRow
								type="error"
								title={t("chat:modelResponseIncomplete")}
								message={t("chat:modelResponseErrors.noAssistantMessages")}
								errorDetails={t("chat:modelResponseErrors.noAssistantMessagesDetails")}
							/>
						)
					}

					// Fallback for generic errors
					return (
						<ErrorRow type="error" message={message.text || t("chat:error")} errorDetails={message.text} />
					)
				}
				case "completion_result":
					return (
						<div className="group">
							<div style={headerStyle}>
								{icon}
								{title}
								<div style={{ flexGrow: 1 }} />
								<OpenMarkdownPreviewButton markdown={message.text} />
							</div>
							<div className="border-l border-green-600/30 ml-2 pl-4 pb-1">
								<Markdown markdown={message.text} partial={message.partial} />
								{!message.partial && enableCheckpoints !== false && completionCheckpoint ? (
									<SeeNewChangesButtons key={completionCheckpoint.ts} />
								) : null}
							</div>
							{/* When the final result was sent. Held back while it streams, like other replies. */}
							{!message.partial && isShowableTimestamp(message.ts) && (
								<div className="ml-6 mt-1">
									<MessageTimestamp ts={message.ts} timeFormat={timeFormat} dateFormat={dateFormat} />
								</div>
							)}
						</div>
					)
				case "shell_integration_warning":
					return <CommandExecutionError />
				case "checkpoint_saved":
					return (
						<CheckpointSaved
							ts={message.ts!}
							commitHash={message.text!}
							currentHash={currentCheckpoint}
							checkpoint={message.checkpoint}
							onJumpToPreviousCheckpoint={onJumpToPreviousCheckpoint}
						/>
					)
				case "condense_context":
					// In-progress state
					if (message.partial) {
						return <InProgressRow eventType="condense_context" />
					}
					// Completed state
					if (message.contextCondense) {
						return <CondensationResultRow data={message.contextCondense} />
					}
					return null
				case "condense_context_error":
					return <CondensationErrorRow errorText={message.text} />
				case "sliding_window_truncation":
					// In-progress state
					if (message.partial) {
						return <InProgressRow eventType="sliding_window_truncation" />
					}
					// Completed state
					if (message.contextTruncation) {
						return <TruncationResultRow data={message.contextTruncation} />
					}
					return null
				case "codebase_search_result": {
					let parsed: {
						content: {
							query: string
							results: Array<{
								filePath: string
								score: number
								startLine: number
								endLine: number
								codeChunk: string
							}>
						}
					} | null = null

					try {
						if (message.text) {
							parsed = JSON.parse(message.text)
						}
					} catch (error) {
						console.error("Failed to parse codebaseSearch content:", error)
					}

					if (parsed && !parsed?.content) {
						console.error("Invalid codebaseSearch content structure:", parsed.content)
						return <div>{t("chat:codebaseSearch.displayError")}</div>
					}

					const { results = [] } = parsed?.content || {}

					return <CodebaseSearchResultsDisplay results={results} />
				}
				case "user_edit_todos":
					return <UpdateTodoListToolBlock userEdited onChange={() => {}} />
				case "tool":
					return <ToolResultRow message={message} headerStyle={headerStyle} t={t} />
				case "image": {
					// Parse the JSON to get imageUri and imagePath
					const imageInfo = safeJsonParse<{ imageUri: string; imagePath: string }>(message.text || "{}")
					if (!imageInfo) {
						return null
					}
					return (
						<div style={{ marginTop: "10px" }}>
							<ImageBlock imageUri={imageInfo.imageUri} imagePath={imageInfo.imagePath} />
						</div>
					)
				}
				case "too_many_tools_warning": {
					const warningData = safeJsonParse<{
						toolCount: number
						serverCount: number
						threshold: number
					}>(message.text || "{}")
					if (!warningData) return null
					const toolsPart = t("chat:tooManyTools.toolsPart", { count: warningData.toolCount })
					const serversPart = t("chat:tooManyTools.serversPart", { count: warningData.serverCount })
					return (
						<WarningRow
							title={t("chat:tooManyTools.title")}
							message={t("chat:tooManyTools.messageTemplate", {
								tools: toolsPart,
								servers: serversPart,
								threshold: warningData.threshold,
							})}
							actionText={t("chat:tooManyTools.openMcpSettings")}
							onAction={() =>
								window.postMessage(
									{ type: "action", action: "settingsButtonClicked", values: { section: "mcp" } },
									"*",
								)
							}
						/>
					)
				}
				case "ignored_disabled_tools_warning": {
					const ignoredData = safeJsonParse<{ ignoredTools: unknown }>(message.text || "{}")
					const ignoredTools = ignoredData?.ignoredTools
					if (
						!Array.isArray(ignoredTools) ||
						ignoredTools.length === 0 ||
						!ignoredTools.every((tool) => typeof tool === "string")
					) {
						return null
					}
					return (
						<WarningRow
							title={t("chat:ignoredDisabledTools.title")}
							message={t("chat:ignoredDisabledTools.messageTemplate", {
								tools: ignoredTools.join(", "),
							})}
						/>
					)
				}
				default:
					return (
						<>
							{title && (
								<div style={headerStyle}>
									{icon}
									{title}
								</div>
							)}
							<div style={{ paddingTop: 10 }}>
								<Markdown markdown={message.text} partial={message.partial} />
							</div>
						</>
					)
			}
		case "ask":
			switch (message.ask) {
				case "mistake_limit_reached":
					return <ErrorRow type="mistake_limit" message={message.text || ""} errorDetails={message.text} />
				case "command":
					return (
						<CommandExecution
							executionId={message.ts.toString()}
							text={message.text}
							icon={icon}
							title={title}
							isDenied={message.autoApprovalDecision === "deny"}
						/>
					)
				case "use_mcp_server": {
					// Parse the message text to get the MCP server request
					const messageJson = safeJsonParse<Partial<ClineAskUseMcpServer>>(message.text, {})!

					// Extract the response field if it exists
					const { response, ...mcpServerRequest } = messageJson

					// Create the useMcpServer object with the response field
					const useMcpServer = {
						...mcpServerRequest,
						response,
					} as ClineAskUseMcpServer

					if (!useMcpServer) {
						return null
					}

					const server = mcpServers?.find((server) => server.name === useMcpServer.serverName)

					return (
						<>
							<div style={headerStyle}>
								{icon}
								{title}
							</div>
							<div className="w-full bg-vscode-editor-background border border-vscode-border rounded-xs p-2 mt-2">
								{useMcpServer.type === "access_mcp_resource" && (
									<McpResourceRow
										item={{
											// Use the matched resource/template details, with fallbacks
											...(findMatchingResourceOrTemplate(
												useMcpServer.uri || "",
												server?.resources,
												server?.resourceTemplates,
											) || {
												name: "",
												mimeType: "",
												description: "",
											}),
											// Always use the actual URI from the request
											uri: useMcpServer.uri || "",
										}}
									/>
								)}
								{useMcpServer.type === "use_mcp_tool" && (
									<McpExecution
										executionId={message.ts.toString()}
										text={useMcpServer.arguments !== "{}" ? useMcpServer.arguments : undefined}
										serverName={useMcpServer.serverName}
										toolName={useMcpServer.toolName}
										isArguments={true}
										server={server}
										useMcpServer={useMcpServer}
										alwaysAllowMcp={alwaysAllowMcp}
									/>
								)}
							</div>
						</>
					)
				}
				case "completion_result":
					if (message.text) {
						return (
							<div className="group">
								<div style={headerStyle}>
									{icon}
									{title}
									<div style={{ flexGrow: 1 }} />
									<OpenMarkdownPreviewButton markdown={message.text} />
								</div>
								<div style={{ color: "var(--vscode-charts-green)", paddingTop: 10 }}>
									<Markdown markdown={message.text} partial={message.partial} />
									{!message.partial && enableCheckpoints !== false && completionCheckpoint ? (
										<SeeNewChangesButtons key={completionCheckpoint.ts} />
									) : null}
								</div>
							</div>
						)
					} else {
						return null // Don't render anything when we get a completion_result ask without text
					}
				case "followup":
					return (
						<>
							{title && (
								<div style={headerStyle}>
									{icon}
									{title}
								</div>
							)}
							<div className="flex flex-col gap-2 ml-6">
								<Markdown
									markdown={message.partial === true ? message?.text : followUpData?.question}
								/>
								<FollowUpSuggest
									suggestions={followUpData?.suggest}
									onSuggestionClick={onSuggestionClick}
									ts={message?.ts}
									onCancelAutoApproval={onFollowUpUnmount}
									isAnswered={isFollowUpAnswered}
									isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
								/>
							</div>
						</>
					)
				case "auto_approval_max_req_reached": {
					return <AutoApprovedRequestLimitWarning message={message} />
				}
				default:
					return null
			}
	}
})
