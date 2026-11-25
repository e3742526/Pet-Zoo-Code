// Render the chat rows for file operations and image generation.
// Extracted from ChatRow.tsx.

import type { CSSProperties, ReactNode } from "react"
import type { ClineMessage } from "@roo-code/types"
import type { ChatRowTool, ChatRowTranslation } from "./chatRowMessages"
import { Trans } from "react-i18next"
import { Eye, FileCode2, FileDiff, FolderTree, ListTree, SquareArrowOutUpRight } from "lucide-react"

import { vscode } from "@src/utils/vscode"
import { formatPathTooltip } from "@src/utils/formatPathTooltip"

import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock"
import CodeAccordion from "../common/CodeAccordion"
import { BatchFilePermission } from "./BatchFilePermission"
import { BatchDiffApproval } from "./BatchDiffApproval"
import { PathTooltip } from "../ui/PathTooltip"

export type ChatToolRowProps = {
	message: ClineMessage
	tool: ChatRowTool
	headerStyle: CSSProperties
	isExpanded: boolean
	handleToggleExpand: () => void
	onBatchFileResponse?: (response: { [key: string]: boolean }) => void
	unifiedDiff?: string
	onJumpToCreatedFile?: () => void
	t: ChatRowTranslation
}

export function renderChatFileToolRow(
	{
		message,
		tool,
		headerStyle,
		isExpanded,
		handleToggleExpand,
		onBatchFileResponse,
		unifiedDiff,
		onJumpToCreatedFile,
		t,
	}: ChatToolRowProps,
	toolIcon: (name: string) => ReactNode,
): ReactNode {
	switch (tool.tool as string) {
		case "editedExistingFile":
		case "appliedDiff":
		case "newFileCreated":
		case "searchAndReplace":
		case "search_and_replace":
		case "search_replace":
		case "edit":
		case "edit_file":
		case "apply_patch":
		case "apply_diff":
			// Check if this is a batch diff request
			if (message.type === "ask" && tool.batchDiffs && Array.isArray(tool.batchDiffs)) {
				return (
					<>
						<div style={headerStyle}>
							<FileDiff className="w-4 shrink-0" />
							<span style={{ fontWeight: "bold" }}>
								{t("chat:fileOperations.wantsToApplyBatchChanges")}
							</span>
						</div>
						<BatchDiffApproval files={tool.batchDiffs} ts={message.ts} />
					</>
				)
			}

			// Regular single file diff
			return (
				<>
					<div style={headerStyle}>
						{tool.isProtected ? (
							<span
								className="codicon codicon-lock"
								style={{ color: "var(--vscode-editorWarning-foreground)", marginBottom: "-1.5px" }}
							/>
						) : (
							toolIcon("diff")
						)}
						<span style={{ fontWeight: "bold" }}>
							{tool.isProtected
								? t("chat:fileOperations.wantsToEditProtected")
								: tool.isOutsideWorkspace
									? t("chat:fileOperations.wantsToEditOutsideWorkspace")
									: t("chat:fileOperations.wantsToEdit")}
						</span>
					</div>
					<div className="pl-6">
						<CodeAccordion
							path={tool.path}
							code={unifiedDiff ?? tool.content ?? tool.diff ?? ""}
							language="diff"
							progressStatus={message.progressStatus}
							isLoading={message.partial}
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
							onJumpToFile={onJumpToCreatedFile}
							diffStats={tool.diffStats}
						/>
					</div>
				</>
			)
		case "insertContent":
			return (
				<>
					<div style={headerStyle}>
						{tool.isProtected ? (
							<span
								className="codicon codicon-lock"
								style={{ color: "var(--vscode-editorWarning-foreground)", marginBottom: "-1.5px" }}
							/>
						) : (
							toolIcon("insert")
						)}
						<span style={{ fontWeight: "bold" }}>
							{tool.isProtected
								? t("chat:fileOperations.wantsToEditProtected")
								: tool.isOutsideWorkspace
									? t("chat:fileOperations.wantsToEditOutsideWorkspace")
									: tool.lineNumber === 0
										? t("chat:fileOperations.wantsToInsertAtEnd")
										: t("chat:fileOperations.wantsToInsertWithLineNumber", {
												lineNumber: tool.lineNumber,
											})}
						</span>
					</div>
					<div className="pl-6">
						<CodeAccordion
							path={tool.path}
							code={unifiedDiff ?? tool.diff}
							language="diff"
							progressStatus={message.progressStatus}
							isLoading={message.partial}
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
							diffStats={tool.diffStats}
						/>
					</div>
				</>
			)
		case "readFile": {
			// Check if this is a batch file permission request
			const isBatchRequest = message.type === "ask" && tool.batchFiles && Array.isArray(tool.batchFiles)

			if (isBatchRequest) {
				return (
					<>
						<div style={headerStyle}>
							<Eye className="w-4 shrink-0" />
							<span style={{ fontWeight: "bold" }}>{t("chat:fileOperations.wantsToReadMultiple")}</span>
						</div>
						<BatchFilePermission
							files={tool.batchFiles || []}
							onPermissionResponse={(response) => {
								onBatchFileResponse?.(response)
							}}
							ts={message?.ts}
						/>
					</>
				)
			}

			// Regular single file read request
			return (
				<>
					<div style={headerStyle}>
						<FileCode2 className="w-4 shrink-0" />
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask"
								? tool.isOutsideWorkspace
									? t("chat:fileOperations.wantsToReadOutsideWorkspace")
									: tool.additionalFileCount && tool.additionalFileCount > 0
										? t("chat:fileOperations.wantsToReadAndXMore", {
												count: tool.additionalFileCount,
											})
										: t("chat:fileOperations.wantsToRead")
								: t("chat:fileOperations.didRead")}
						</span>
					</div>
					<div className="pl-6">
						<ToolUseBlock>
							<ToolUseBlockHeader
								className="group"
								onClick={() =>
									vscode.postMessage({
										type: "openFile",
										text: tool.content,
										values: tool.startLine ? { line: tool.startLine } : undefined,
									})
								}>
								{tool.path?.startsWith(".") && <span>.</span>}
								<PathTooltip content={formatPathTooltip(tool.path, tool.reason)}>
									<span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl">
										{formatPathTooltip(tool.path, tool.reason)}
									</span>
								</PathTooltip>
								<div style={{ flexGrow: 1 }}></div>
								<SquareArrowOutUpRight
									className="w-4 shrink-0 codicon codicon-link-external opacity-0 group-hover:opacity-100 transition-opacity"
									style={{ fontSize: 13.5, margin: "1px 0" }}
								/>
							</ToolUseBlockHeader>
						</ToolUseBlock>
					</div>
				</>
			)
		}
		case "listFilesTopLevel":
			return (
				<>
					<div style={headerStyle}>
						<ListTree className="w-4 shrink-0" />
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask"
								? tool.isOutsideWorkspace
									? t("chat:directoryOperations.wantsToViewTopLevelOutsideWorkspace")
									: t("chat:directoryOperations.wantsToViewTopLevel")
								: tool.isOutsideWorkspace
									? t("chat:directoryOperations.didViewTopLevelOutsideWorkspace")
									: t("chat:directoryOperations.didViewTopLevel")}
						</span>
					</div>
					<div className="pl-6">
						<CodeAccordion
							path={tool.path}
							code={tool.content}
							language="shell-session"
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</div>
				</>
			)
		case "listFilesRecursive":
			return (
				<>
					<div style={headerStyle}>
						<FolderTree className="w-4 shrink-0" />
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask"
								? tool.isOutsideWorkspace
									? t("chat:directoryOperations.wantsToViewRecursiveOutsideWorkspace")
									: t("chat:directoryOperations.wantsToViewRecursive")
								: tool.isOutsideWorkspace
									? t("chat:directoryOperations.didViewRecursiveOutsideWorkspace")
									: t("chat:directoryOperations.didViewRecursive")}
						</span>
					</div>
					<div className="pl-6">
						<CodeAccordion
							path={tool.path}
							code={tool.content}
							language="shellsession"
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</div>
				</>
			)
		case "searchFiles":
			return (
				<>
					<div style={headerStyle}>
						{toolIcon("search")}
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask" ? (
								<Trans
									t={t}
									i18nKey={
										tool.isOutsideWorkspace
											? "chat:directoryOperations.wantsToSearchOutsideWorkspace"
											: "chat:directoryOperations.wantsToSearch"
									}
									components={{ code: <code className="font-medium">{tool.regex}</code> }}
									values={{ regex: tool.regex }}
								/>
							) : (
								<Trans
									t={t}
									i18nKey={
										tool.isOutsideWorkspace
											? "chat:directoryOperations.didSearchOutsideWorkspace"
											: "chat:directoryOperations.didSearch"
									}
									components={{ code: <code className="font-medium">{tool.regex}</code> }}
									values={{ regex: tool.regex }}
								/>
							)}
						</span>
					</div>
					<div className="pl-6">
						<CodeAccordion
							path={tool.path! + (tool.filePattern ? `/(${tool.filePattern})` : "")}
							code={tool.content}
							language="shellsession"
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</div>
				</>
			)
		case "generateImage":
			return (
				<>
					<div style={headerStyle}>
						{tool.isProtected ? (
							<span
								className="codicon codicon-lock"
								style={{ color: "var(--vscode-editorWarning-foreground)", marginBottom: "-1.5px" }}
							/>
						) : (
							toolIcon("file-media")
						)}
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask"
								? tool.isProtected
									? t("chat:fileOperations.wantsToGenerateImageProtected")
									: tool.isOutsideWorkspace
										? t("chat:fileOperations.wantsToGenerateImageOutsideWorkspace")
										: t("chat:fileOperations.wantsToGenerateImage")
								: t("chat:fileOperations.didGenerateImage")}
						</span>
					</div>
					{message.type === "ask" && (
						<div className="pl-6">
							<ToolUseBlock>
								<div className="p-2">
									<div className="mb-2 break-words">{tool.content}</div>
									<div className="flex items-center gap-1 text-xs text-vscode-descriptionForeground">
										{tool.path}
									</div>
								</div>
							</ToolUseBlock>
						</div>
					)}
				</>
			)
		default:
			return null
	}
}
