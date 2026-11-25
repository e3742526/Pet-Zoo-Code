// Compatibility facade for the modes view and its mode selection and host messages.
import React, { useState, useEffect, useCallback, useRef } from "react"
import { VSCodeTextArea, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Trans } from "react-i18next"
import { ChevronDown, X, Upload } from "lucide-react"

import type { ModeConfig, PromptComponent } from "@roo-code/types"

import {
	Mode,
	getRoleDefinition,
	getWhenToUse,
	getDescription,
	getCustomInstructions,
	getAllModes,
	findModeBySlug as findCustomModeBySlug,
	defaultModeSlug,
} from "@roo/modes"

import { vscode } from "@src/utils/vscode"
import { buildDocLink } from "@src/utils/docLinks"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { Section } from "@src/components/settings/Section"
import {
	Button,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Command,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandItem,
	CommandGroup,
	StandardTooltip,
} from "@src/components/ui"
import { DeleteModeDialog } from "@src/components/modes/DeleteModeDialog"
import { useEscapeKey } from "@src/hooks/useEscapeKey"

import { useCreateModeDialog } from "./CreateModeDialog"
import { ModeImportDialog } from "./ModeImportDialog"
import { ModesToolbar } from "./ModesToolbar"
import { ModeToolsSection } from "./ModeToolsSection"
import { SystemPromptPreview } from "./SystemPromptPreview"

type ImportModeResult = { type: "importModeResult"; success: boolean; slug?: string; error?: string }

function getModeTextValue(event: Event | React.FormEvent<HTMLElement>): string {
	const detail = (event as CustomEvent<{ target?: { value?: string } }>).detail
	return detail?.target?.value ?? (event.target as HTMLInputElement | HTMLTextAreaElement).value
}

const ModesView = () => {
	const { t } = useAppTranslation()

	const {
		customModePrompts,
		listApiConfigMeta,
		currentApiConfigName,
		mode,
		customInstructions,
		setCustomInstructions,
		customModes,
		mcpServers,
	} = useExtensionState()

	// Use a local state to track the visually active mode
	// This prevents flickering when switching modes rapidly by:
	// 1. Updating the UI immediately when a mode is clicked
	// 2. Not syncing with the backend mode state (which would cause flickering)
	// 3. Still sending the mode change to the backend for persistence
	const [visualMode, setVisualMode] = useState(mode)

	// Build modes fresh each render so search reflects inline rename updates immediately
	const modes = getAllModes(customModes)

	const [isDialogOpen, setIsDialogOpen] = useState(false)
	const [selectedPromptContent, setSelectedPromptContent] = useState("")
	const [selectedPromptTitle, setSelectedPromptTitle] = useState("")
	const [isToolsEditMode, setIsToolsEditMode] = useState(false)
	const [isExporting, setIsExporting] = useState(false)
	const [isImporting, setIsImporting] = useState(false)
	const [showImportDialog, setShowImportDialog] = useState(false)
	const [importLevel, setImportLevel] = useState<"global" | "project">("project")
	const [hasRulesToExport, setHasRulesToExport] = useState<Record<string, boolean>>({})
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
	const [modeToDelete, setModeToDelete] = useState<{
		slug: string
		name: string
		source?: string
		rulesFolderPath?: string
	} | null>(null)

	// State for mode selection popover and search
	const [open, setOpen] = useState(false)
	const [searchValue, setSearchValue] = useState("")
	const searchInputRef = useRef<HTMLInputElement>(null)

	// removed unused local name state (replaced by inline rename UX)

	// Inline rename state for the mode dropdown row
	const [isRenamingMode, setIsRenamingMode] = useState(false)
	const [renameInputValue, setRenameInputValue] = useState("")
	const renameInputRef = useRef<React.ElementRef<typeof VSCodeTextField>>(null)

	// Optimistic rename map so search reflects new names immediately
	const [localRenames, setLocalRenames] = useState<Record<string, string>>({})
	// Display list that overlays optimistic names
	const displayModes = (modes || []).map((m) => (localRenames[m.slug] ? { ...m, name: localRenames[m.slug] } : m))

	// Direct update functions
	const updateAgentPrompt = useCallback(
		(mode: Mode, promptData: PromptComponent) => {
			const existingPrompt = customModePrompts?.[mode] as PromptComponent
			const updatedPrompt = { ...existingPrompt, ...promptData }

			// Only include properties that differ from defaults
			if (updatedPrompt.roleDefinition === getRoleDefinition(mode)) {
				delete updatedPrompt.roleDefinition
			}
			if (updatedPrompt.description === getDescription(mode)) {
				delete updatedPrompt.description
			}
			if (updatedPrompt.whenToUse === getWhenToUse(mode)) {
				delete updatedPrompt.whenToUse
			}

			vscode.postMessage({
				type: "updatePrompt",
				promptMode: mode,
				customPrompt: updatedPrompt,
			})
		},
		[customModePrompts],
	)

	const updateCustomMode = useCallback((slug: string, modeConfig: ModeConfig) => {
		const source = modeConfig.source || "global"

		vscode.postMessage({
			type: "updateCustomMode",
			slug,
			modeConfig: {
				...modeConfig,
				source, // Ensure source is set
			},
		})
	}, [])

	// Helper function to find a mode by slug
	const findModeBySlug = useCallback(
		(searchSlug: string, modes: readonly ModeConfig[] | undefined): ModeConfig | undefined => {
			return findCustomModeBySlug(searchSlug, modes)
		},
		[],
	)

	const switchMode = useCallback((slug: string) => {
		vscode.postMessage({
			type: "mode",
			text: slug,
		})
	}, [])

	// Handle mode switching with explicit state initialization
	const handleModeSwitch = useCallback(
		(modeConfig: ModeConfig) => {
			if (modeConfig.slug === visualMode) return // Prevent unnecessary updates

			// Immediately update visual state for instant feedback
			setVisualMode(modeConfig.slug)

			// Then send the mode change message to the backend
			switchMode(modeConfig.slug)

			// Exit tools edit mode when switching modes
			setIsToolsEditMode(false)
		},
		[visualMode, switchMode],
	)

	// Refs to track latest state/functions for message handler (which has no dependencies)
	const handleModeSwitchRef = useRef(handleModeSwitch)
	const customModesRef = useRef(customModes)
	const switchModeRef = useRef(switchMode)

	// Update refs when dependencies change
	useEffect(() => {
		handleModeSwitchRef.current = handleModeSwitch
	}, [handleModeSwitch])

	useEffect(() => {
		customModesRef.current = customModes
	}, [customModes])

	useEffect(() => {
		switchModeRef.current = switchMode
	}, [switchMode])

	// Sync visualMode with backend mode changes to prevent desync.
	//
	// Flicker A guard: a state push from the host can arrive mid-switch
	// carrying a stale `mode` field (the previous mode), which would briefly
	// revert `visualMode` and cause the entire detail panel to flash to the
	// old mode for one frame. We compare against a ref of the current
	// `visualMode` (rather than reading it from the closure) so we can keep
	// `[mode]` as the only dep — the effect should react ONLY to external
	// host-driven mode changes, not to our own optimistic `setVisualMode`
	// in `handleModeSwitch`. Using a ref avoids the need for a lint-rule
	// disable on the exhaustive-deps check.
	const visualModeRef = useRef(visualMode)
	useEffect(() => {
		visualModeRef.current = visualMode
	}, [visualMode])
	useEffect(() => {
		if (mode && mode !== visualModeRef.current) {
			setVisualMode(mode)
		}
	}, [mode])

	// Handler for popover open state change
	const onOpenChange = useCallback((open: boolean) => {
		setOpen(open)
		// Reset search when closing the popover
		if (!open) {
			setTimeout(() => setSearchValue(""), 100)
		}
	}, [])

	// Use the shared ESC key handler hook
	useEscapeKey(open, () => setOpen(false))

	// Handler for clearing search input
	const onClearSearch = useCallback(() => {
		setSearchValue("")
		searchInputRef.current?.focus()
	}, [])

	// Focus rename input when entering rename mode
	useEffect(() => {
		if (isRenamingMode) {
			const id = setTimeout(() => {
				// FAST forwards the custom element, although the ref type describes the React wrapper.
				const input = renameInputRef.current
				if (input instanceof HTMLElement) input.focus()
			}, 0)
			return () => clearTimeout(id)
		}
	}, [isRenamingMode])

	const handleStartRenameMode = useCallback(() => {
		const customMode = findModeBySlug(visualMode, customModes)
		if (customMode) {
			setIsRenamingMode(true)
			setRenameInputValue(customMode.name)
		}
	}, [visualMode, customModes, findModeBySlug])

	const handleCancelRenameMode = useCallback(() => {
		setIsRenamingMode(false)
		setRenameInputValue("")
	}, [])

	const handleSaveRenameMode = useCallback(() => {
		const customMode = findModeBySlug(visualMode, customModes)
		const trimmed = renameInputValue.trim()
		if (!customMode || !trimmed) {
			setIsRenamingMode(false)
			return
		}
		// Prevent duplicate names against other modes
		const nameTaken = modes.some(
			(m) => m.name.toLowerCase() === trimmed.toLowerCase() && m.slug !== customMode.slug,
		)
		if (nameTaken) {
			// simple guard: do nothing if taken
			return
		}
		updateCustomMode(visualMode, {
			...customMode,
			name: trimmed,
			source: customMode.source || "global",
		})
		// Optimistically reflect rename in UI/search immediately
		setLocalRenames((prev) => ({ ...prev, [visualMode]: trimmed }))
		setIsRenamingMode(false)
	}, [visualMode, customModes, renameInputValue, modes, updateCustomMode, findModeBySlug])

	// Helper function to get current mode's config
	const getCurrentMode = useCallback((): ModeConfig | undefined => {
		const findMode = (m: ModeConfig): boolean => m.slug === visualMode
		return customModes?.find(findMode) || modes.find(findMode)
	}, [visualMode, customModes, modes])

	// Check if the current mode has rules to export
	const checkRulesDirectory = useCallback((slug: string) => {
		vscode.postMessage({
			type: "checkRulesDirectory",
			slug: slug,
		})
	}, [])

	// Check rules directory when mode changes
	useEffect(() => {
		const currentMode = getCurrentMode()
		if (currentMode?.slug && hasRulesToExport[currentMode.slug] === undefined) {
			checkRulesDirectory(currentMode.slug)
		}
	}, [getCurrentMode, checkRulesDirectory, hasRulesToExport])

	// Ensure import dialog defaults to "project" each open
	useEffect(() => {
		if (showImportDialog) {
			setImportLevel("project")
		}
	}, [showImportDialog])

	const handleCreateMode = useCallback(
		(newMode: ModeConfig) => {
			updateCustomMode(newMode.slug, newMode)
			// Immediately select the newly created mode in the UI.
			setVisualMode(newMode.slug)
			switchMode(newMode.slug)
		},
		[updateCustomMode, switchMode],
	)
	const { openCreateModeDialog, dialog: createModeDialog } = useCreateModeDialog(modes, mcpServers, handleCreateMode)

	// Use a ref to store the current modeToDelete value
	const modeToDeleteRef = useRef(modeToDelete)

	// Update the ref whenever modeToDelete changes
	useEffect(() => {
		modeToDeleteRef.current = modeToDelete
	}, [modeToDelete])

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "systemPrompt") {
				if (message.text) {
					setSelectedPromptContent(message.text)
					setSelectedPromptTitle(`System Prompt (${message.mode} mode)`)
					setIsDialogOpen(true)
				}
			} else if (message.type === "exportModeResult") {
				setIsExporting(false)

				if (!message.success) {
					// Show error message
					console.error("Failed to export mode:", message.error)
				}
			} else if (message.type === "importModeResult") {
				setIsImporting(false)
				setShowImportDialog(false)

				if (message.success) {
					const { slug } = message as ImportModeResult
					if (slug) {
						// Try switching using the freshest mode list available
						const all = getAllModes(customModesRef.current)
						const importedMode = all.find((m) => m.slug === slug)
						if (importedMode) {
							handleModeSwitchRef.current(importedMode)
						} else {
							// Fallback: slug not yet in state (race condition) - select default mode
							setVisualMode(defaultModeSlug)
							switchModeRef.current?.(defaultModeSlug)
						}
					}
				} else {
					// Only log error if it's not a cancellation
					if (message.error !== "cancelled") {
						console.error("Failed to import mode:", message.error)
					}
				}
				// Note: Auto-select after import will be handled by PR #9003
			} else if (message.type === "checkRulesDirectoryResult") {
				setHasRulesToExport((prev) => ({
					...prev,
					[message.slug]: message.hasContent,
				}))
			} else if (message.type === "deleteCustomModeCheck") {
				// Handle the check response
				// Use the ref to get the current modeToDelete value
				const currentModeToDelete = modeToDeleteRef.current
				if (message.slug && currentModeToDelete && currentModeToDelete.slug === message.slug) {
					setModeToDelete({
						...currentModeToDelete,
						rulesFolderPath: message.rulesFolderPath,
					})
					setShowDeleteConfirm(true)
				}
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [checkRulesDirectory, switchMode])

	const handleAgentReset = (
		modeSlug: string,
		type: "roleDefinition" | "description" | "whenToUse" | "customInstructions",
	) => {
		// Only reset for built-in modes
		const existingPrompt = customModePrompts?.[modeSlug] as PromptComponent
		const updatedPrompt = { ...existingPrompt }
		delete updatedPrompt[type] // Remove the field entirely to ensure it reloads from defaults

		vscode.postMessage({
			type: "updatePrompt",
			promptMode: modeSlug,
			customPrompt: updatedPrompt,
		})
	}

	return (
		<div>
			<Section>
				<div>
					<ModesToolbar isImporting={isImporting} onImport={() => setShowImportDialog(true)} />

					<div className="flex items-center gap-1 mb-3">
						{isRenamingMode ? (
							<>
								<VSCodeTextField
									ref={renameInputRef}
									value={renameInputValue}
									onInput={(e: unknown) => {
										const target = e as { target: { value: string } }
										setRenameInputValue(target.target.value)
									}}
									className="grow"
									placeholder={t("prompts:createModeDialog.name.placeholder")}
								/>
								<StandardTooltip content={t("settings:common.save")}>
									<Button
										variant="ghost"
										size="icon"
										disabled={!renameInputValue.trim()}
										onClick={handleSaveRenameMode}
										data-testid="save-mode-rename-button">
										<span className="codicon codicon-check" />
									</Button>
								</StandardTooltip>
								<StandardTooltip content={t("settings:common.cancel")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={handleCancelRenameMode}
										data-testid="cancel-mode-rename-button">
										<span className="codicon codicon-close" />
									</Button>
								</StandardTooltip>
							</>
						) : (
							<>
								<Popover open={open} onOpenChange={onOpenChange}>
									<PopoverTrigger asChild>
										<Button
											variant="combobox"
											role="combobox"
											aria-expanded={open}
											className="justify-between grow"
											data-testid="mode-select-trigger">
											<div className="truncate">
												{localRenames[visualMode] ??
													getCurrentMode()?.name ??
													t("prompts:modes.selectMode")}
											</div>
											<ChevronDown className="opacity-50" />
										</Button>
									</PopoverTrigger>
									<PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
										<Command>
											<div className="relative">
												<CommandInput
													ref={searchInputRef}
													value={searchValue}
													onValueChange={setSearchValue}
													placeholder={t("prompts:modes.selectMode")}
													className="h-9 mr-4"
													data-testid="mode-search-input"
												/>
												{searchValue.length > 0 && (
													<div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
														<X
															className="text-vscode-input-foreground opacity-50 hover:opacity-100 size-4 p-0.5 cursor-pointer"
															onClick={onClearSearch}
														/>
													</div>
												)}
											</div>
											<CommandList>
												<CommandEmpty>
													{searchValue && (
														<div className="py-2 px-1 text-sm">
															{t("prompts:modes.noMatchFound")}
														</div>
													)}
												</CommandEmpty>
												<CommandGroup>
													{displayModes
														.filter((modeConfig) =>
															searchValue
																? modeConfig.name
																		.toLowerCase()
																		.includes(searchValue.toLowerCase())
																: true,
														)
														.map((modeConfig) => (
															<CommandItem
																key={modeConfig.slug}
																value={`${modeConfig.name} ${modeConfig.slug}`}
																onSelect={() => {
																	handleModeSwitch(modeConfig)
																	setOpen(false)
																}}
																data-testid={`mode-option-${modeConfig.slug}`}>
																<div className="flex items-center justify-between w-full">
																	<span
																		style={{
																			whiteSpace: "nowrap",
																			overflow: "hidden",
																			textOverflow: "ellipsis",
																			flex: 2,
																			minWidth: 0,
																		}}>
																		{modeConfig.name}
																	</span>
																	<span
																		className="text-foreground"
																		style={{
																			whiteSpace: "nowrap",
																			overflow: "hidden",
																			textOverflow: "ellipsis",
																			direction: "rtl",
																			textAlign: "right",
																			flex: 1,
																			minWidth: 0,
																			marginLeft: "0.5em",
																		}}>
																		{modeConfig.slug}
																	</span>
																</div>
															</CommandItem>
														))}
												</CommandGroup>
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>

								{/* New mode (+) moved here from the top bar */}
								<StandardTooltip content={t("prompts:modes.createNewMode")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={openCreateModeDialog}
										data-testid="add-mode-button">
										<span className="codicon codicon-add" />
									</Button>
								</StandardTooltip>

								{/* Edit (rename) mode - only enabled for custom modes */}
								<StandardTooltip content={t("settings:providers.renameProfile")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={handleStartRenameMode}
										data-testid="rename-mode-button"
										disabled={!findModeBySlug(visualMode, customModes)}>
										<span className="codicon codicon-edit" />
									</Button>
								</StandardTooltip>

								{/* Delete mode - disabled for built-in modes */}
								<StandardTooltip content={t("prompts:createModeDialog.deleteMode")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => {
											const customMode = findModeBySlug(visualMode, customModes)
											if (customMode) {
												setModeToDelete({
													slug: customMode.slug,
													name: customMode.name,
													source: customMode.source || "global",
												})
												vscode.postMessage({
													type: "deleteCustomMode",
													slug: customMode.slug,
													checkOnly: true,
												})
											}
										}}
										data-testid="delete-mode-button"
										disabled={!findModeBySlug(visualMode, customModes)}>
										<span className="codicon codicon-trash" />
									</Button>
								</StandardTooltip>

								{/* Export mode (kept here to the right of the dropdown) */}
								<StandardTooltip content={t("prompts:exportMode.title")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => {
											const currentMode = getCurrentMode()
											if (currentMode?.slug && !isExporting) {
												setIsExporting(true)
												vscode.postMessage({
													type: "exportMode",
													slug: currentMode.slug,
												})
											}
										}}
										disabled={isExporting}
										title={t("prompts:exportMode.title")}
										data-testid="export-mode-toolbar-button">
										<Upload className="h-4 w-4" />
									</Button>
								</StandardTooltip>
							</>
						)}
					</div>

					{/* API Configuration - Moved Here */}
					<div className="mb-3">
						<div className="font-bold mb-1">{t("prompts:apiConfiguration.title")}</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							{t("prompts:apiConfiguration.select")}
						</div>
						<div className="mb-2">
							<Select
								value={currentApiConfigName}
								onValueChange={(value) => {
									vscode.postMessage({
										type: "loadApiConfiguration",
										text: value,
									})
								}}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t("settings:common.select")} />
								</SelectTrigger>
								<SelectContent>
									{(listApiConfigMeta || []).map((config) => (
										<SelectItem key={config.id} value={config.name}>
											{config.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>

				{/* Role Definition section */}
				<div className="mb-4">
					<div className="flex justify-between items-center mb-1">
						<div className="font-bold">{t("prompts:roleDefinition.title")}</div>
						{!findModeBySlug(visualMode, customModes) && (
							<StandardTooltip content={t("prompts:roleDefinition.resetToDefault")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "roleDefinition")
										}
									}}
									data-testid="role-definition-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							</StandardTooltip>
						)}
					</div>
					<div className="text-sm text-vscode-descriptionForeground mb-2">
						{t("prompts:roleDefinition.description")}
					</div>
					<VSCodeTextArea
						resize="vertical"
						value={(() => {
							const customMode = findModeBySlug(visualMode, customModes)
							const prompt = customModePrompts?.[visualMode] as PromptComponent
							return customMode?.roleDefinition ?? prompt?.roleDefinition ?? getRoleDefinition(visualMode)
						})()}
						onChange={(e) => {
							const value = getModeTextValue(e)
							const customMode = findModeBySlug(visualMode, customModes)
							if (customMode) {
								// For custom modes, update the JSON file
								updateCustomMode(visualMode, {
									...customMode,
									roleDefinition: value.trim() || "",
									source: customMode.source || "global",
								})
							} else {
								// For built-in modes, update the prompts
								updateAgentPrompt(visualMode, {
									roleDefinition: value.trim() || undefined,
								})
							}
						}}
						className="w-full"
						rows={5}
						data-testid={`${getCurrentMode()?.slug || "code"}-prompt-textarea`}
					/>
				</div>

				{/* Description section */}
				<div className="mb-4">
					<div className="flex justify-between items-center mb-1">
						<div className="font-bold">{t("prompts:description.title")}</div>
						{!findModeBySlug(visualMode, customModes) && (
							<StandardTooltip content={t("prompts:description.resetToDefault")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "description")
										}
									}}
									data-testid="description-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							</StandardTooltip>
						)}
					</div>
					<div className="text-sm text-vscode-descriptionForeground mb-2">
						{t("prompts:description.description")}
					</div>
					<VSCodeTextField
						value={(() => {
							const customMode = findModeBySlug(visualMode, customModes)
							const prompt = customModePrompts?.[visualMode] as PromptComponent
							return customMode?.description ?? prompt?.description ?? getDescription(visualMode)
						})()}
						onChange={(e) => {
							const value = getModeTextValue(e)
							const customMode = findModeBySlug(visualMode, customModes)
							if (customMode) {
								// For custom modes, update the JSON file
								updateCustomMode(visualMode, {
									...customMode,
									description: value.trim() || undefined,
									source: customMode.source || "global",
								})
							} else {
								// For built-in modes, update the prompts
								updateAgentPrompt(visualMode, {
									description: value.trim() || undefined,
								})
							}
						}}
						className="w-full"
						data-testid={`${getCurrentMode()?.slug || "code"}-description-textfield`}
					/>
				</div>

				{/* When to Use section */}
				<div className="mb-4">
					<div className="flex justify-between items-center mb-1">
						<div className="font-bold">{t("prompts:whenToUse.title")}</div>
						{!findModeBySlug(visualMode, customModes) && (
							<StandardTooltip content={t("prompts:whenToUse.resetToDefault")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "whenToUse")
										}
									}}
									data-testid="when-to-use-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							</StandardTooltip>
						)}
					</div>
					<div className="text-sm text-vscode-descriptionForeground mb-2">
						{t("prompts:whenToUse.description")}
					</div>
					<VSCodeTextArea
						resize="vertical"
						value={(() => {
							const customMode = findModeBySlug(visualMode, customModes)
							const prompt = customModePrompts?.[visualMode] as PromptComponent
							return customMode?.whenToUse ?? prompt?.whenToUse ?? getWhenToUse(visualMode)
						})()}
						onChange={(e) => {
							const value = getModeTextValue(e)
							const customMode = findModeBySlug(visualMode, customModes)
							if (customMode) {
								// For custom modes, update the JSON file
								updateCustomMode(visualMode, {
									...customMode,
									whenToUse: value.trim() || undefined,
									source: customMode.source || "global",
								})
							} else {
								// For built-in modes, update the prompts
								updateAgentPrompt(visualMode, {
									whenToUse: value.trim() || undefined,
								})
							}
						}}
						className="w-full"
						rows={4}
						data-testid={`${getCurrentMode()?.slug || "code"}-when-to-use-textarea`}
					/>
				</div>

				<ModeToolsSection
					customMode={findModeBySlug(visualMode, customModes)}
					getCurrentMode={getCurrentMode}
					isToolsEditMode={isToolsEditMode}
					setIsToolsEditMode={setIsToolsEditMode}
					mcpServers={mcpServers}
					updateCustomMode={updateCustomMode}
				/>

				{/* Role definition for both built-in and custom modes */}
				<div className="mb-2">
					<div className="flex justify-between items-center mb-1">
						<div className="font-bold">{t("prompts:customInstructions.title")}</div>
						{!findModeBySlug(visualMode, customModes) && (
							<StandardTooltip content={t("prompts:customInstructions.resetToDefault")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "customInstructions")
										}
									}}
									data-testid="custom-instructions-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							</StandardTooltip>
						)}
					</div>
					<div className="text-[13px] text-vscode-descriptionForeground mb-2">
						{t("prompts:customInstructions.description", {
							modeName: getCurrentMode()?.name || "Code",
						})}
					</div>
					<VSCodeTextArea
						resize="vertical"
						value={(() => {
							const customMode = findModeBySlug(visualMode, customModes)
							const prompt = customModePrompts?.[visualMode] as PromptComponent
							return (
								customMode?.customInstructions ??
								prompt?.customInstructions ??
								getCustomInstructions(visualMode, customModes)
							)
						})()}
						onChange={(e) => {
							const value = getModeTextValue(e)
							const customMode = findModeBySlug(visualMode, customModes)
							if (customMode) {
								// For custom modes, update the JSON file
								updateCustomMode(visualMode, {
									...customMode,
									// Preserve empty string; only treat null/undefined as unset
									customInstructions: value ?? undefined,
									source: customMode.source || "global",
								})
							} else {
								// For built-in modes, update the prompts
								const existingPrompt = customModePrompts?.[visualMode] as PromptComponent
								updateAgentPrompt(visualMode, {
									...existingPrompt,
									customInstructions: value.trim() || undefined,
								})
							}
						}}
						rows={10}
						className="w-full"
						data-testid={`${getCurrentMode()?.slug || "code"}-custom-instructions-textarea`}
					/>
					<div className="text-xs text-vscode-descriptionForeground mt-1.5">
						<Trans
							t={t}
							i18nKey="prompts:customInstructions.loadFromFile"
							values={{
								mode: getCurrentMode()?.name || "Code",
								slug: getCurrentMode()?.slug || "code",
							}}
							components={{
								span: (
									<span
										className="text-vscode-textLink-foreground cursor-pointer underline"
										onClick={() => {
											const currentMode = getCurrentMode()
											if (!currentMode) return

											// Open or create an empty file
											vscode.postMessage({
												type: "openFile",
												text: `./.roo/rules-${currentMode.slug}/rules.md`,
												values: {
													create: true,
													content: "",
												},
											})
										}}
									/>
								),
								"0": (
									<VSCodeLink
										href={buildDocLink(
											"features/custom-instructions#global-rules-directory",
											"prompts_mode_specific_global_rules",
										)}
										style={{ display: "inline" }}
										aria-label={t("prompts:customInstructions.loadFromFileAriaLabel")}
									/>
								),
							}}
						/>
					</div>
				</div>

				<div className="pb-4 border-b border-vscode-input-border">
					<div className="flex gap-2 mb-4">
						<Button
							variant="primary"
							onClick={() => {
								const currentMode = getCurrentMode()
								if (currentMode) {
									vscode.postMessage({
										type: "getSystemPrompt",
										mode: currentMode.slug,
									})
								}
							}}
							data-testid="preview-prompt-button">
							{t("prompts:systemPrompt.preview")}
						</Button>
						<StandardTooltip content={t("prompts:systemPrompt.copy")}>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => {
									const currentMode = getCurrentMode()
									if (currentMode) {
										vscode.postMessage({
											type: "copySystemPrompt",
											mode: currentMode.slug,
										})
									}
								}}
								data-testid="copy-prompt-button">
								<span className="codicon codicon-copy"></span>
							</Button>
						</StandardTooltip>
					</div>
				</div>

				<div className="pb-5">
					<h3 className="text-vscode-foreground mb-3">{t("prompts:globalCustomInstructions.title")}</h3>

					<div className="text-sm text-vscode-descriptionForeground mb-2">
						<Trans t={t} i18nKey="prompts:globalCustomInstructions.description">
							<VSCodeLink
								href={buildDocLink(
									"features/custom-instructions#setting-up-global-rules",
									"prompts_global_custom_instructions",
								)}
								style={{ display: "inline" }}
								aria-label={t("prompts:globalCustomInstructions.learnMoreAriaLabel")}></VSCodeLink>
						</Trans>
					</div>
					<VSCodeTextArea
						resize="vertical"
						value={customInstructions || ""}
						onChange={(e) => {
							const value = getModeTextValue(e)
							setCustomInstructions(value ?? undefined)
							vscode.postMessage({
								type: "customInstructions",
								text: value ?? undefined,
							})
						}}
						rows={4}
						className="w-full"
						data-testid="global-custom-instructions-textarea"
					/>
					<div className="text-xs text-vscode-descriptionForeground mt-1.5">
						<Trans
							t={t}
							i18nKey="prompts:globalCustomInstructions.loadFromFile"
							components={{
								span: (
									<span
										className="text-vscode-textLink-foreground cursor-pointer underline"
										onClick={() =>
											vscode.postMessage({
												type: "openFile",
												text: "./.roo/rules/rules.md",
												values: {
													create: true,
													content: "",
												},
											})
										}
									/>
								),
								"0": (
									<VSCodeLink
										href={buildDocLink(
											"features/custom-instructions#setting-up-global-rules",
											"prompts_global_rules",
										)}
										style={{ display: "inline" }}
										aria-label={t("prompts:globalCustomInstructions.loadFromFileAriaLabel")}
									/>
								),
							}}
						/>
					</div>
				</div>
			</Section>

			{createModeDialog}

			{isDialogOpen && (
				<SystemPromptPreview
					selectedPromptTitle={selectedPromptTitle}
					selectedPromptContent={selectedPromptContent}
					modeName={getCurrentMode()?.name}
					onClose={() => setIsDialogOpen(false)}
				/>
			)}

			{showImportDialog && (
				<ModeImportDialog
					importLevel={importLevel}
					setImportLevel={setImportLevel}
					isImporting={isImporting}
					setIsImporting={setIsImporting}
					onClose={() => setShowImportDialog(false)}
				/>
			)}

			{/* Delete Mode Confirmation Dialog */}
			<DeleteModeDialog
				open={showDeleteConfirm}
				onOpenChange={setShowDeleteConfirm}
				modeToDelete={modeToDelete}
				onConfirm={() => {
					if (modeToDelete) {
						vscode.postMessage({
							type: "deleteCustomMode",
							slug: modeToDelete.slug,
						})
						setShowDeleteConfirm(false)
						setModeToDelete(null)
					}
				}}
			/>
		</div>
	)
}

export default ModesView
