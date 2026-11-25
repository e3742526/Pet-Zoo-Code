// Own the form and validation for creating a custom mode.
// Extracted from ModesView.tsx.

import { useState, useEffect, useCallback } from "react"
import {
	VSCodeCheckbox,
	VSCodeRadioGroup,
	VSCodeRadio,
	VSCodeTextArea,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { modeConfigSchema, type GroupEntry, type McpServer, type ModeConfig } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, Input } from "@src/components/ui"

import McpServerChecklist from "./McpServerChecklist"
import { availableGroups, getGroupName } from "./modeToolGroups"

type ModeSource = "global" | "project"

export function useCreateModeDialog(
	modes: readonly ModeConfig[],
	mcpServers: McpServer[],
	onCreate: (mode: ModeConfig) => void,
) {
	const { t } = useAppTranslation()
	const [isCreateModeDialogOpen, setIsCreateModeDialogOpen] = useState(false)
	// State for create mode dialog
	const [newModeName, setNewModeName] = useState("")
	const [newModeSlug, setNewModeSlug] = useState("")
	const [newModeDescription, setNewModeDescription] = useState("")
	const [newModeRoleDefinition, setNewModeRoleDefinition] = useState("")
	const [newModeWhenToUse, setNewModeWhenToUse] = useState("")
	const [newModeCustomInstructions, setNewModeCustomInstructions] = useState("")
	const [newModeGroups, setNewModeGroups] = useState<GroupEntry[]>(availableGroups)
	const [newModeSource, setNewModeSource] = useState<ModeSource>("global")
	const [newModeAllowedMcpServers, setNewModeAllowedMcpServers] = useState<string[] | undefined>(undefined)

	// Field-specific error states
	const [nameError, setNameError] = useState<string>("")
	const [slugError, setSlugError] = useState<string>("")
	const [descriptionError, setDescriptionError] = useState<string>("")
	const [roleDefinitionError, setRoleDefinitionError] = useState<string>("")
	const [groupsError, setGroupsError] = useState<string>("")

	// Helper to reset form state
	const resetFormState = useCallback(() => {
		// Reset form fields
		setNewModeName("")
		setNewModeSlug("")
		setNewModeDescription("")
		setNewModeGroups(availableGroups)
		setNewModeRoleDefinition("")
		setNewModeWhenToUse("")
		setNewModeCustomInstructions("")
		setNewModeSource("global")
		setNewModeAllowedMcpServers(undefined)
		// Reset error states
		setNameError("")
		setSlugError("")
		setDescriptionError("")
		setRoleDefinitionError("")
		setGroupsError("")
	}, [])

	// Reset form fields when dialog opens
	useEffect(() => {
		if (isCreateModeDialogOpen) {
			resetFormState()
		}
	}, [isCreateModeDialogOpen, resetFormState])

	// Helper function to generate a unique slug from a name
	const generateSlug = useCallback((name: string, attempt = 0): string => {
		const baseSlug = name
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/^-+|-+$/g, "")
		return attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`
	}, [])

	// Handler for name changes
	const handleNameChange = useCallback(
		(name: string) => {
			setNewModeName(name)
			setNewModeSlug(generateSlug(name))
		},
		[generateSlug],
	)

	const handleCreateMode = useCallback(() => {
		// Clear previous errors
		setNameError("")
		setSlugError("")
		setDescriptionError("")
		setRoleDefinitionError("")
		setGroupsError("")

		const source = newModeSource
		const newMode: ModeConfig = {
			slug: newModeSlug,
			name: newModeName,
			description: newModeDescription.trim() || undefined,
			roleDefinition: newModeRoleDefinition.trim(),
			whenToUse: newModeWhenToUse.trim() || undefined,
			customInstructions: newModeCustomInstructions.trim() || undefined,
			groups: newModeGroups,
			source,
			allowedMcpServers: newModeAllowedMcpServers,
		}

		// Validate the mode against the schema
		const result = modeConfigSchema.safeParse(newMode)

		if (!result.success) {
			// Map Zod errors to specific fields
			result.error.issues.forEach((error) => {
				const field = error.path[0] as string
				const message = error.message

				switch (field) {
					case "name":
						setNameError(message)
						break
					case "slug":
						setSlugError(message)
						break
					case "description":
						setDescriptionError(message)
						break
					case "roleDefinition":
						setRoleDefinitionError(message)
						break
					case "groups":
						setGroupsError(message)
						break
				}
			})
			return
		}

		onCreate(newMode)
		setIsCreateModeDialogOpen(false)
		resetFormState()
	}, [
		newModeName,
		newModeSlug,
		newModeDescription,
		newModeRoleDefinition,
		newModeWhenToUse,
		newModeCustomInstructions,
		newModeGroups,
		newModeSource,
		newModeAllowedMcpServers,
		onCreate,
		resetFormState,
	])

	const isNameOrSlugTaken = useCallback(
		(name: string, slug: string) => {
			return modes.some((m) => m.slug === slug || m.name === name)
		},
		[modes],
	)

	const openCreateModeDialog = useCallback(() => {
		const baseNamePrefix = "New Custom Mode"
		// Find unique name and slug
		let attempt = 0
		let name = baseNamePrefix
		let slug = generateSlug(name)
		while (isNameOrSlugTaken(name, slug)) {
			attempt++
			name = `${baseNamePrefix} ${attempt + 1}`
			slug = generateSlug(name)
		}
		setNewModeName(name)
		setNewModeSlug(slug)
		setIsCreateModeDialogOpen(true)
	}, [generateSlug, isNameOrSlugTaken])

	const dialog = isCreateModeDialogOpen ? (
		<div className="fixed inset-0 flex justify-end bg-black/50 z-[1000]">
			<div className="w-[calc(100vw-100px)] h-full bg-vscode-editor-background shadow-md flex flex-col relative">
				<div className="flex-1 p-5 overflow-y-auto min-h-0">
					<Button
						variant="ghost"
						size="icon"
						onClick={() => setIsCreateModeDialogOpen(false)}
						className="absolute top-5 right-5">
						<span className="codicon codicon-close"></span>
					</Button>
					<h2 className="mb-4">{t("prompts:createModeDialog.title")}</h2>
					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.name.label")}</div>
						<Input
							type="text"
							value={newModeName}
							onChange={(e) => {
								handleNameChange(e.target.value)
							}}
							className="w-full"
						/>
						{nameError && <div className="text-xs text-vscode-errorForeground mt-1">{nameError}</div>}
					</div>
					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.slug.label")}</div>
						<Input
							type="text"
							value={newModeSlug}
							onChange={(e) => {
								setNewModeSlug(e.target.value)
							}}
							className="w-full"
						/>
						<div className="text-xs text-vscode-descriptionForeground mt-1">
							{t("prompts:createModeDialog.slug.description")}
						</div>
						{slugError && <div className="text-xs text-vscode-errorForeground mt-1">{slugError}</div>}
					</div>
					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.saveLocation.label")}</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.saveLocation.description")}
						</div>
						<VSCodeRadioGroup
							value={newModeSource}
							onChange={(e: Event | React.FormEvent<HTMLElement>) => {
								const target = ((e as CustomEvent)?.detail?.target ||
									(e.target as HTMLInputElement)) as HTMLInputElement
								setNewModeSource(target.value as ModeSource)
							}}>
							<VSCodeRadio value="global">
								{t("prompts:createModeDialog.saveLocation.global.label")}
								<div className="text-xs text-vscode-descriptionForeground mt-0.5">
									{t("prompts:createModeDialog.saveLocation.global.description")}
								</div>
							</VSCodeRadio>
							<VSCodeRadio value="project">
								{t("prompts:createModeDialog.saveLocation.project.label")}
								<div className="text-xs text-vscode-descriptionForeground mt-0.5">
									{t("prompts:createModeDialog.saveLocation.project.description")}
								</div>
							</VSCodeRadio>
						</VSCodeRadioGroup>
					</div>

					<div style={{ marginBottom: "16px" }}>
						<div style={{ fontWeight: "bold", marginBottom: "4px" }}>
							{t("prompts:createModeDialog.roleDefinition.label")}
						</div>
						<div
							style={{
								fontSize: "13px",
								color: "var(--vscode-descriptionForeground)",
								marginBottom: "8px",
							}}>
							{t("prompts:createModeDialog.roleDefinition.description")}
						</div>
						<VSCodeTextArea
							resize="vertical"
							value={newModeRoleDefinition}
							onChange={(e) => {
								setNewModeRoleDefinition((e.target as HTMLTextAreaElement).value)
							}}
							rows={4}
							className="w-full"
						/>
						{roleDefinitionError && (
							<div className="text-xs text-vscode-errorForeground mt-1">{roleDefinitionError}</div>
						)}
					</div>

					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.description.label")}</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.description.description")}
						</div>
						<VSCodeTextField
							value={newModeDescription}
							onChange={(e) => {
								setNewModeDescription((e.target as HTMLInputElement).value)
							}}
							className="w-full"
						/>
						{descriptionError && (
							<div className="text-xs text-vscode-errorForeground mt-1">{descriptionError}</div>
						)}
					</div>

					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.whenToUse.label")}</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.whenToUse.description")}
						</div>
						<VSCodeTextArea
							resize="vertical"
							value={newModeWhenToUse}
							onChange={(e) => {
								setNewModeWhenToUse((e.target as HTMLTextAreaElement).value)
							}}
							rows={3}
							className="w-full"
						/>
					</div>
					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.tools.label")}</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.tools.description")}
						</div>
						<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
							{availableGroups.map((group) => (
								<VSCodeCheckbox
									key={group}
									checked={newModeGroups.some((g) => getGroupName(g) === group)}
									onChange={(e: Event | React.FormEvent<HTMLElement>) => {
										const target =
											(e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
										const checked = target.checked
										if (checked) {
											setNewModeGroups([...newModeGroups, group])
										} else {
											setNewModeGroups(newModeGroups.filter((g) => getGroupName(g) !== group))
										}
									}}>
									{t(`prompts:tools.toolNames.${group}`)}
								</VSCodeCheckbox>
							))}
						</div>
						{groupsError && <div className="text-xs text-vscode-errorForeground mt-1">{groupsError}</div>}
						{/* MCP Server Restriction in create dialog */}
						{newModeGroups.some((g) => getGroupName(g) === "mcp") && (
							<div className="mt-3 ml-1" data-testid="create-mcp-server-restriction">
								<VSCodeCheckbox
									checked={newModeAllowedMcpServers !== undefined}
									data-testid="create-restrict-mcp-servers-toggle"
									onChange={(e: Event | React.FormEvent<HTMLElement>) => {
										const target =
											(e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
										const checked = target.checked
										setNewModeAllowedMcpServers(checked ? [] : undefined)
									}}>
									{t("prompts:mcpServers.restrict")}
								</VSCodeCheckbox>
								{newModeAllowedMcpServers !== undefined && (
									<McpServerChecklist
										allowedMcpServers={newModeAllowedMcpServers}
										mcpServers={mcpServers}
										testIdPrefix="create-mcp-server"
										onServerToggle={(serverName) => (e) => {
											const target =
												(e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
											const checked = target.checked
											setNewModeAllowedMcpServers((prev) => {
												const current = prev ?? []
												return checked
													? current.includes(serverName)
														? current
														: [...current, serverName]
													: current.filter((s) => s !== serverName)
											})
										}}
									/>
								)}
							</div>
						)}
					</div>
					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.customInstructions.label")}</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.customInstructions.description")}
						</div>
						<VSCodeTextArea
							resize="vertical"
							value={newModeCustomInstructions}
							onChange={(e) => {
								setNewModeCustomInstructions((e.target as HTMLTextAreaElement).value)
							}}
							rows={4}
							className="w-full"
						/>
					</div>
				</div>
				<div className="flex justify-end p-3 px-5 gap-2 border-t border-vscode-editor-lineHighlightBorder bg-vscode-editor-background">
					<Button variant="secondary" onClick={() => setIsCreateModeDialogOpen(false)}>
						{t("prompts:createModeDialog.buttons.cancel")}
					</Button>
					<Button variant="primary" onClick={handleCreateMode}>
						{t("prompts:createModeDialog.buttons.create")}
					</Button>
				</div>
			</div>
		</div>
	) : null

	return { openCreateModeDialog, dialog }
}
