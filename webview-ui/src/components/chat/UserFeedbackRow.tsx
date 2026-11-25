// Display and edit a user message. The active text editor subscribes to model settings.
// Extracted from ChatRow.tsx.

import React, { useCallback, useEffect, useState } from "react"
import type { ClineMessage, ExtensionMessage } from "@roo-code/types"
import { Edit, Trash2, User } from "lucide-react"

import { Mode } from "@roo/modes"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { appendImages } from "@src/utils/imageUtils"
import { cn } from "@/lib/utils"

import Thumbnails from "../common/Thumbnails"
import { Mention } from "./Mention"
import { isShowableTimestamp, MessageTimestamp } from "./MessageTimestamp"
import { ChatTextArea } from "./ChatTextArea"
import { MAX_IMAGES_PER_MESSAGE } from "./constants"
import { useSelectedModel } from "../ui/hooks/useSelectedModel"

type UserFeedbackRowProps = {
	message: ClineMessage
	mode?: Mode
	isStreaming: boolean
	headerStyle: React.CSSProperties
	timeFormat?: React.ComponentProps<typeof MessageTimestamp>["timeFormat"]
	dateFormat?: React.ComponentProps<typeof MessageTimestamp>["dateFormat"]
}

type EditChatTextAreaProps = Omit<React.ComponentProps<typeof ChatTextArea>, "shouldDisableImages"> & {
	messageTs: number
}

function EditChatTextArea({ messageTs, setSelectedImages, ...props }: EditChatTextAreaProps) {
	const { apiConfiguration } = useExtensionState()
	const { info: model } = useSelectedModel(apiConfiguration)

	useEffect(() => {
		const handleMessage = ({ data }: MessageEvent<ExtensionMessage>) => {
			if (data?.type === "selectedImages" && data.context === "edit" && data.messageTs === messageTs) {
				setSelectedImages((images) => appendImages(images, data.images, MAX_IMAGES_PER_MESSAGE))
			}
		}
		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [messageTs, setSelectedImages])

	return (
		<ChatTextArea {...props} setSelectedImages={setSelectedImages} shouldDisableImages={!model?.supportsImages} />
	)
}

export function UserFeedbackRow({
	message,
	mode,
	isStreaming,
	headerStyle,
	timeFormat,
	dateFormat,
}: UserFeedbackRowProps) {
	const { t } = useAppTranslation()
	const [isEditing, setIsEditing] = useState(false)
	const [editedContent, setEditedContent] = useState("")
	const [editMode, setEditMode] = useState<Mode>(mode || "code")
	const [editImages, setEditImages] = useState<string[]>([])

	// Handle edit button click
	const handleEditClick = useCallback(() => {
		setIsEditing(true)
		setEditedContent(message.text || "")
		setEditImages(message.images || [])
		setEditMode(mode || "code")
		// Edit mode is now handled entirely in the frontend
		// No need to notify the backend
	}, [message.text, message.images, mode])

	// Handle cancel edit
	const handleCancelEdit = useCallback(() => {
		setIsEditing(false)
		setEditedContent(message.text || "")
		setEditImages(message.images || [])
		setEditMode(mode || "code")
	}, [message.text, message.images, mode])

	// Handle save edit
	const handleSaveEdit = useCallback(() => {
		setIsEditing(false)
		// Send edited message to backend
		vscode.postMessage({
			type: "submitEditedMessage",
			value: message.ts,
			editedMessageContent: editedContent,
			images: editImages,
		})
	}, [message.ts, editedContent, editImages])

	// Handle image selection for editing
	const handleSelectImages = useCallback(() => {
		vscode.postMessage({ type: "selectImages", context: "edit", messageTs: message.ts })
	}, [message.ts])

	return (
		<div className="group">
			<div style={headerStyle}>
				<User className="w-4 shrink-0" />
				<span style={{ fontWeight: "bold" }}>{t("chat:feedback.youSaid")}</span>
			</div>
			<div
				className={cn(
					"ml-6 border rounded-sm overflow-hidden whitespace-pre-wrap",
					isEditing
						? "bg-vscode-editor-background text-vscode-editor-foreground"
						: "cursor-text p-1 bg-vscode-editor-foreground/70 text-vscode-editor-background",
				)}>
				{isEditing ? (
					<div className="flex flex-col gap-2">
						<EditChatTextArea
							messageTs={message.ts}
							inputValue={editedContent}
							setInputValue={setEditedContent}
							sendingDisabled={false}
							selectApiConfigDisabled={true}
							placeholderText={t("chat:editMessage.placeholder")}
							selectedImages={editImages}
							setSelectedImages={setEditImages}
							onSend={handleSaveEdit}
							onSelectImages={handleSelectImages}
							mode={editMode}
							setMode={setEditMode}
							modeShortcutText=""
							isEditMode={true}
							onCancel={handleCancelEdit}
						/>
					</div>
				) : (
					<div className="flex justify-between">
						<div
							className="flex-grow px-2 py-1 wrap-anywhere rounded-lg transition-colors"
							onClick={(e) => {
								e.stopPropagation()
								if (!isStreaming) {
									handleEditClick()
								}
							}}
							title={t("chat:queuedMessages.clickToEdit")}>
							<Mention text={message.text} withShadow />
						</div>
						<div className="flex gap-2 pr-1">
							<div
								className="cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
								style={{ visibility: isStreaming ? "hidden" : "visible" }}
								onClick={(e) => {
									e.stopPropagation()
									handleEditClick()
								}}>
								<Edit className="w-4 shrink-0" aria-label={t("common:confirmation.editMessage")} />
							</div>
							<div
								className="cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
								style={{ visibility: isStreaming ? "hidden" : "visible" }}
								onClick={(e) => {
									e.stopPropagation()
									vscode.postMessage({ type: "deleteMessage", value: message.ts })
								}}>
								<Trash2 className="w-4 shrink-0" aria-label={t("common:confirmation.deleteMessage")} />
							</div>
						</div>
					</div>
				)}
				{!isEditing && message.images && message.images.length > 0 && (
					<Thumbnails images={message.images} style={{ marginTop: "8px" }} />
				)}
			</div>
			{/* When the message was sent. Hidden while editing: the edit box replaces the bubble. */}
			{!isEditing && isShowableTimestamp(message.ts) && (
				<div className="ml-6 mt-1">
					<MessageTimestamp ts={message.ts} timeFormat={timeFormat} dateFormat={dateFormat} />
				</div>
			)}
		</div>
	)
}
