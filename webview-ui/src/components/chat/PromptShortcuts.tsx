import { useEffect, useRef, useState } from "react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { Bookmark, ChevronDown, Plus, Settings2, Trash2 } from "lucide-react"

import {
	type ExtensionMessage,
	type PromptShortcut,
	type PromptShortcutScope,
	promptShortcutsSchema,
} from "@roo-code/types"

import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	Input,
	Textarea,
} from "@/components/ui"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { enabledSelectorTriggerClassName, selectorTriggerClassName } from "@/components/ui/selectorTriggerStyles"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"

interface PromptShortcutsProps {
	shortcuts: PromptShortcut[]
	repoShortcuts?: PromptShortcut[]
	repoPath?: string
	onInsert: (text: string) => void
}

export function PromptShortcuts({ shortcuts, repoShortcuts = [], repoPath, onInsert }: PromptShortcutsProps) {
	const { t } = useAppTranslation()
	const portalContainer = useRooPortal("roo-portal")
	const [editorOpen, setEditorOpen] = useState(false)
	const [editorScope, setEditorScope] = useState<PromptShortcutScope>("repository")
	const [draft, setDraft] = useState<PromptShortcut[]>([])
	const [pendingRequest, setPendingRequest] = useState<string>()
	const [saveError, setSaveError] = useState(false)
	const selectedText = useRef<string>()

	// This editor saves directly from the composer. Keep edits local until Save,
	// and retain them if storage fails, just as the settings page does.
	useEffect(() => {
		if (!pendingRequest) return
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (message.type !== "settingsSaveResult" || message.requestId !== pendingRequest) return
			setPendingRequest(undefined)
			setSaveError(!message.success)
			if (message.success) setEditorOpen(false)
		}
		const timeout = setTimeout(() => {
			setPendingRequest(undefined)
			setSaveError(true)
		}, 15000)
		window.addEventListener("message", handleMessage)
		return () => {
			clearTimeout(timeout)
			window.removeEventListener("message", handleMessage)
		}
	}, [pendingRequest])

	const updateDraft = (id: string, changes: Partial<PromptShortcut>) => {
		setDraft((previous) =>
			previous.map((shortcut) => (shortcut.id === id ? { ...shortcut, ...changes } : shortcut)),
		)
	}

	const openEditor = (scope: PromptShortcutScope) => {
		setEditorScope(scope)
		setDraft((scope === "global" ? shortcuts : repoShortcuts).map((shortcut) => ({ ...shortcut })))
		setSaveError(false)
		setEditorOpen(true)
	}

	const save = () => {
		if (editorScope === "repository" && !repoPath) return
		const result = promptShortcutsSchema.safeParse(draft)
		if (!result.success) return
		const requestId = crypto.randomUUID()
		setSaveError(false)
		setPendingRequest(requestId)
		vscode.postMessage({
			type: "savePromptShortcuts",
			requestId,
			promptShortcutScope: editorScope,
			...(editorScope === "repository" ? { cwd: repoPath } : {}),
			promptShortcuts: result.data,
		})
	}

	const renderShortcuts = (entries: PromptShortcut[]) =>
		entries.map((shortcut) => (
			<DropdownMenuItem key={shortcut.id} onSelect={() => (selectedText.current = shortcut.text)}>
				<div className="min-w-0">
					<div className="break-words">{shortcut.name}</div>
					<div className="truncate text-xs opacity-70">{shortcut.text}</div>
				</div>
			</DropdownMenuItem>
		))

	return (
		<>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					aria-label={t("chat:promptShortcuts.title")}
					className={cn(
						"inline-flex shrink-0 items-center gap-1 px-1.5 py-1 text-xs",
						selectorTriggerClassName,
						enabledSelectorTriggerClassName,
					)}>
					<Bookmark className="size-3.5" />
					{t("chat:promptShortcuts.button")}
					<ChevronDown className="size-3" />
				</DropdownMenu.Trigger>
				<DropdownMenuContent
					container={portalContainer}
					align="end"
					side="top"
					className="bg-vscode-dropdown-background max-w-[calc(100vw-24px)] w-72 max-h-[min(60vh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
					onCloseAutoFocus={(event) => {
						if (selectedText.current === undefined) return
						event.preventDefault()
						onInsert(selectedText.current)
						selectedText.current = undefined
					}}>
					{shortcuts.length === 0 && (!repoPath || repoShortcuts.length === 0) && (
						<div className="p-2 text-sm text-vscode-descriptionForeground">
							{t("chat:promptShortcuts.empty")}
						</div>
					)}
					{repoPath && repoShortcuts.length > 0 && (
						<>
							<DropdownMenuLabel>{t("chat:promptShortcuts.repository")}</DropdownMenuLabel>
							{renderShortcuts(repoShortcuts)}
						</>
					)}
					{shortcuts.length > 0 && (
						<>
							<DropdownMenuLabel>{t("chat:promptShortcuts.global")}</DropdownMenuLabel>
							{renderShortcuts(shortcuts)}
						</>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem disabled={!repoPath} onSelect={() => openEditor("repository")}>
						<Settings2 />
						{t("chat:promptShortcuts.manageRepository")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => openEditor("global")}>
						<Settings2 />
						{t("chat:promptShortcuts.manageGlobal")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu.Root>

			<Dialog open={editorOpen} onOpenChange={(open) => !pendingRequest && setEditorOpen(open)}>
				<DialogContent className="max-h-[85vh] flex flex-col min-w-0 p-4">
					<DialogHeader className="pr-6">
						<DialogTitle>
							{t(
								editorScope === "global"
									? "chat:promptShortcuts.manageGlobal"
									: "chat:promptShortcuts.manageRepository",
							)}
						</DialogTitle>
						<DialogDescription>
							{t(
								editorScope === "global"
									? "chat:promptShortcuts.globalDescription"
									: "chat:promptShortcuts.repositoryDescription",
							)}
						</DialogDescription>
					</DialogHeader>
					<div className="min-h-0 overflow-y-auto space-y-3">
						{draft.map((shortcut, index) => (
							<fieldset
								key={shortcut.id}
								disabled={!!pendingRequest}
								className="m-0 min-w-0 flex flex-col gap-2 rounded border border-vscode-panel-border p-3">
								<legend className="sr-only">
									{t("chat:promptShortcuts.entry", { number: index + 1 })}
								</legend>
								<div className="flex items-end gap-2">
									<label className="flex min-w-0 flex-1 flex-col gap-1">
										{t("chat:promptShortcuts.name")}
										<Input
											value={shortcut.name}
											maxLength={80}
											onChange={(event) => updateDraft(shortcut.id, { name: event.target.value })}
										/>
									</label>
									<Button
										variant="ghost"
										size="icon"
										aria-label={t("chat:promptShortcuts.delete", { name: shortcut.name })}
										onClick={() =>
											setDraft((previous) => previous.filter(({ id }) => id !== shortcut.id))
										}>
										<Trash2 />
									</Button>
								</div>
								<label className="flex flex-col gap-1">
									{t("chat:promptShortcuts.text")}
									<Textarea
										value={shortcut.text}
										rows={3}
										onChange={(event) => updateDraft(shortcut.id, { text: event.target.value })}
									/>
								</label>
							</fieldset>
						))}
					</div>
					<Button
						variant="outline"
						disabled={!!pendingRequest}
						onClick={() =>
							setDraft((previous) => [...previous, { id: crypto.randomUUID(), name: "", text: "" }])
						}>
						<Plus />
						{t("chat:promptShortcuts.add")}
					</Button>
					{saveError && <div role="alert">{t("chat:promptShortcuts.saveError")}</div>}
					<DialogFooter>
						<Button variant="secondary" disabled={!!pendingRequest} onClick={() => setEditorOpen(false)}>
							{t("chat:promptShortcuts.cancel")}
						</Button>
						<Button
							variant="primary"
							disabled={!!pendingRequest || !promptShortcutsSchema.safeParse(draft).success}
							onClick={save}>
							{t(pendingRequest ? "chat:promptShortcuts.saving" : "chat:promptShortcuts.save")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
