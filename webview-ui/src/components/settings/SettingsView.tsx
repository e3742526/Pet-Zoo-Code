import React, {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import {
	CheckCheck,
	GitBranch,
	Bell,
	Database,
	SquareTerminal,
	FlaskConical,
	TriangleAlert,
	Globe,
	Info,
	MessageSquare,
	LucideIcon,
	SquareSlash,
	Glasses,
	Plug,
	Server,
	UsersRound,
	ArrowLeft,
	GitCommitVertical,
	GraduationCap,
	ScrollText,
} from "lucide-react"

import {
	type ProviderSettings,
	type ExperimentId,
	DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES,
	DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES_AFTER_USER_EDITED,
	DEFAULT_AUTO_CLOSE_ZOO_OPENED_NEW_FILES,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	DEFAULT_TASK_TITLE_GENERATION_ENABLED,
	GLOBAL_SETTINGS_KEYS,
	ImageGenerationProvider,
	isRetiredProvider,
	providerIdentifiers,
} from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { cn } from "@src/lib/utils"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { ExtensionStateContextType, useExtensionState } from "@src/context/ExtensionStateContext"
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogCancel,
	AlertDialogAction,
	AlertDialogHeader,
	AlertDialogFooter,
	Button,
	Checkbox,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
	StandardTooltip,
} from "@src/components/ui"

import { Tab, TabContent, TabHeader, TabList, TabTrigger } from "../common/Tab"
import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import ApiConfigManager from "./ApiConfigManager"
import ApiOptions from "./ApiOptions"
import { AutoApproveSettings } from "./AutoApproveSettings"
import { CheckpointSettings } from "./CheckpointSettings"
import { NotificationSettings } from "./NotificationSettings"
import { ContextManagementSettings } from "./ContextManagementSettings"
import { TerminalSettings } from "./TerminalSettings"
import { ExperimentalSettings } from "./ExperimentalSettings"
import { LanguageSettings } from "./LanguageSettings"
import { About } from "./About"
import { Section } from "./Section"
import PromptsSettings from "./PromptsSettings"
import { SlashCommandsSettings } from "./SlashCommandsSettings"
import { SkillsSettings } from "./SkillsSettings"
import { RulesSettings } from "./RulesSettings"
import { UISettings } from "./UISettings"
import ModesView from "../modes/ModesView"
import McpView from "../mcp/McpView"
import { WorktreesView } from "../worktrees/WorktreesView"
import { SettingsSearch } from "./SettingsSearch"
import { buildSettingsSearchIndex } from "./settingsSearchIndex"
import { nextSaveRequestId } from "./saveRequestId"
import { useSettingsDraft } from "./useSettingsDraft"

const settingsDraftFields = [...GLOBAL_SETTINGS_KEYS.filter((key) => key !== "taskHistory"), "debug"]

/**
 * How long the form waits for the host to answer a save that changes a time or date setting. The host always answers
 * (success or failure), but a write that never settles would otherwise leave Save disabled until the webview reloads.
 * After this the save is treated as failed: the edits stay unsaved and Save works again.
 */
export const SAVE_ANSWER_TIMEOUT_MS = 20_000

export const settingsTabsContainer = "flex flex-1 overflow-hidden [&.narrow_.tab-label]:hidden"
export const settingsTabList =
	"w-48 data-[compact=true]:w-12 flex-shrink-0 flex flex-col overflow-y-auto overflow-x-hidden border-r border-vscode-sideBar-background"
export const settingsTabTrigger =
	"whitespace-nowrap overflow-hidden min-w-0 h-12 px-4 py-3 box-border flex items-center border-l-2 border-transparent text-vscode-foreground opacity-70 hover:bg-vscode-list-hoverBackground data-[compact=true]:w-12 data-[compact=true]:p-4"
export const settingsTabTriggerActive = "opacity-100 border-vscode-focusBorder bg-vscode-list-activeSelectionBackground"

export interface SettingsViewRef {
	checkUnsaveChanges: (then: () => void) => void
}

export const sectionNames = [
	"providers",
	"autoApprove",
	"slashCommands",
	"skills",
	"rules",
	"checkpoints",
	"notifications",
	"contextManagement",
	"terminal",
	"modes",
	"mcp",
	"worktrees",
	"prompts",
	"ui",
	"experimental",
	"language",
	"about",
] as const

export type SectionName = (typeof sectionNames)[number]

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
}

const SettingsView = forwardRef<SettingsViewRef, SettingsViewProps>(({ onDone, targetSection }, ref) => {
	const { t } = useAppTranslation()

	const extensionState = useExtensionState()
	const { currentApiConfigName, listApiConfigMeta, uriScheme, settingsImportedAt, mode } = extensionState
	const quotaFallbackProfiles = (listApiConfigMeta ?? []).filter(
		({ id, name, apiProvider }) =>
			id &&
			name !== currentApiConfigName &&
			apiProvider &&
			apiProvider !== providerIdentifiers.museCode &&
			!isRetiredProvider(apiProvider),
	)

	const [isDiscardDialogShow, setDiscardDialogShow] = useState(false)
	const [isChangeDetected, setChangeDetected] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
	const [activeTab, setActiveTab] = useState<SectionName>(
		targetSection && sectionNames.includes(targetSection as SectionName)
			? (targetSection as SectionName)
			: "providers",
	)

	const scrollPositions = useRef<Record<SectionName, number>>(
		Object.fromEntries(sectionNames.map((s) => [s, 0])) as Record<SectionName, number>,
	)
	const contentRef = useRef<HTMLDivElement | null>(null)

	const prevApiConfigName = useRef(currentApiConfigName)
	const prevMode = useRef(mode)
	const handledSettingsImportedAt = useRef<number | undefined>(undefined)
	const confirmDialogHandler = useRef<() => void>()

	const {
		draft: settingsDraft,
		update: updateSetting,
		captureSave: captureSettingsSave,
		markSaved: markSettingsSaved,
		reset: resetSettings,
	} = useSettingsDraft(extensionState, settingsDraftFields)
	const {
		draft: providerDraft,
		update: updateProviderSetting,
		captureSave: captureProviderSave,
		markSaved: markProviderSaved,
		reset: resetProvider,
	} = useSettingsDraft(extensionState.apiConfiguration)
	const cachedState = useMemo(
		() => ({ ...settingsDraft, apiConfiguration: providerDraft }),
		[settingsDraft, providerDraft],
	)
	const quotaFallbackId = cachedState.apiConfiguration.museCodeQuotaFallbackProfileId ?? ""
	const hasQuotaFallback = quotaFallbackProfiles.some(({ id }) => id === quotaFallbackId)
	const quotaFallbackControlId = useId()
	const quotaFallbackDescriptionId = `${quotaFallbackControlId}-description`
	// The save waiting for the host's answer, and the form state it sent. The "unsaved changes" flag stays on until the
	// host says it was stored, and then goes off only if the user has not edited anything since.
	const [pendingSaveId, setPendingSaveId] = useState<string | undefined>(undefined)
	const sentState = useRef<
		| {
				id: string
				settings: ReturnType<typeof captureSettingsSave>
				provider: ReturnType<typeof captureProviderSave>
		  }
		| undefined
	>(undefined)
	const discardEdits = useCallback(() => {
		sentState.current = undefined
		setPendingSaveId(undefined)
		resetSettings()
		resetProvider()
		setChangeDetected(false)
	}, [resetSettings, resetProvider])

	const {
		apiConfiguration,
		alwaysAllowReadOnly,
		alwaysAllowReadOnlyOutsideWorkspace,
		allowedReadFiles,
		allowedCommands,
		deniedCommands,
		allowedMaxRequests,
		allowedMaxCost,
		language,
		alwaysAllowExecute,
		destructiveCommandGuardEnabled,
		alwaysDenyUnapprovedCommands,
		alwaysAllowMcp,
		alwaysAllowModeSwitch,
		alwaysAllowSubtasks,
		alwaysAllowWrite,
		alwaysAllowWriteOutsideWorkspace,
		alwaysAllowWriteProtected,
		allowedWriteFiles,
		autoCondenseContext,
		autoCondenseContextPercent,
		enableCheckpoints,
		checkpointTimeout,
		experiments,
		maxOpenTabsContext,
		maxWorkspaceFiles,
		mcpEnabled,
		soundEnabled,
		ttsEnabled,
		ttsSpeed,
		soundVolume,
		terminalOutputPreviewSize,
		terminalShellIntegrationTimeout,
		terminalShellIntegrationDisabled, // Added from upstream
		collapseCommandOutputByDefault,
		terminalCommandDelay,
		terminalPowershellCounter,
		terminalZshClearEolMark,
		terminalZshOhMy,
		terminalZshP10k,
		terminalZdotdir,
		terminalProfile,
		writeDelayMs,
		diffFuzzyThreshold,
		showRooIgnoredFiles,
		enableSubfolderRules,
		maxImageFileSize,
		maxTotalImageSize,
		customSupportPrompts,
		profileThresholds,
		alwaysAllowFollowupQuestions,
		followupAutoApproveTimeoutMs,
		includeDiagnosticMessages,
		maxDiagnosticMessages,
		includeTaskHistoryInEnhance,
		taskTitleGenerationEnabled,
		taskTitleApiConfigId,
		imageGenerationProvider,
		openRouterImageApiKey,
		openRouterImageGenerationSelectedModel,
		reasoningBlockCollapsed,
		chatFontSize,
		timeFormat,
		dateFormat,
		showRelativeTimes,
		enterBehavior,
		includeCurrentTime,
		includeCurrentCost,
		maxGitStatusFiles,
		autoCloseZooOpenedFiles,
		autoCloseZooOpenedFilesAfterUserEdited,
		autoCloseZooOpenedNewFiles,
	} = cachedState

	useLayoutEffect(() => {
		// Update when currentApiConfigName or mode changes.
		// Expected to be triggered by loadApiConfiguration/upsertApiConfiguration or mode switch.
		if (prevApiConfigName.current === currentApiConfigName && prevMode.current === mode) {
			return
		}

		discardEdits()
		prevApiConfigName.current = currentApiConfigName
		prevMode.current = mode
	}, [currentApiConfigName, mode, discardEdits])

	// Bust the cache when settings are imported.
	useLayoutEffect(() => {
		if (!settingsImportedAt || handledSettingsImportedAt.current === settingsImportedAt) {
			return
		}

		handledSettingsImportedAt.current = settingsImportedAt
		discardEdits()
	}, [settingsImportedAt, discardEdits])

	const markChanged = useCallback(<Value,>(value: Value) => {
		setChangeDetected(true)
		return value
	}, [])

	const setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType> = useCallback(
		(field, value) => updateSetting(field, (previous) => (previous === value ? previous : markChanged(value))),
		[markChanged, updateSetting],
	)

	const setApiConfigurationField = useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K], isUserAction: boolean = true) => {
			updateProviderSetting(field, (previous) => {
				if (previous === value) return previous

				if (!isUserAction) {
					// Automatic writes that leave the same value do not pin it against host updates.
					const sameValue =
						(previous == null && value == null) ||
						(typeof previous === "object" &&
							typeof value === "object" &&
							JSON.stringify(previous) === JSON.stringify(value))
					if (sameValue) return previous

					const isInitialSync = (previous == null || previous === "") && value != null && value !== ""
					if (isInitialSync) return value
				}
				return markChanged(value)
			})
		},
		[markChanged, updateProviderSetting],
	)

	const setExperimentEnabled: SetExperimentEnabled = useCallback(
		(id: ExperimentId, enabled: boolean) =>
			updateSetting("experiments", (previous) =>
				previous?.[id] === enabled ? previous : markChanged({ ...previous, [id]: enabled }),
			),
		[markChanged, updateSetting],
	)

	const setDebug = useCallback((debug: boolean) => setCachedStateField("debug", debug), [setCachedStateField])

	const setImageGenerationProvider = useCallback(
		(provider: ImageGenerationProvider) => setCachedStateField("imageGenerationProvider", provider),
		[setCachedStateField],
	)

	const setOpenRouterImageApiKey = useCallback(
		(apiKey: string) => setCachedStateField("openRouterImageApiKey", apiKey),
		[setCachedStateField],
	)

	const setImageGenerationSelectedModel = useCallback(
		(model: string) => setCachedStateField("openRouterImageGenerationSelectedModel", model),
		[setCachedStateField],
	)

	const setCustomSupportPromptsField = useCallback(
		(prompts: Record<string, string | undefined>) =>
			updateSetting("customSupportPrompts", (previous) =>
				JSON.stringify(previous) === JSON.stringify(prompts) ? previous : markChanged(prompts),
			),
		[markChanged, updateSetting],
	)

	const isSettingValid = !errorMessage

	// The time and date values are written one at a time on the host, and a write can fail: a save that changes one of
	// them waits for the host's answer. Every other save behaves as it always did.
	const displayChanged =
		(cachedState.timeFormat ?? "auto") !== (extensionState.timeFormat ?? "auto") ||
		(cachedState.dateFormat ?? "auto") !== (extensionState.dateFormat ?? "auto") ||
		(cachedState.showRelativeTimes ?? true) !== (extensionState.showRelativeTimes ?? true)

	const handleSubmit = () => {
		if (isSettingValid) {
			const saveId = displayChanged ? nextSaveRequestId() : undefined
			const savedSettings = captureSettingsSave()
			const savedProvider = captureProviderSave()
			if (saveId) {
				sentState.current = { id: saveId, settings: savedSettings, provider: savedProvider }
				setPendingSaveId(saveId)
			}

			vscode.postMessage({
				type: "updateSettings",
				requestId: saveId,
				updatedSettings: {
					language,
					alwaysAllowReadOnly: alwaysAllowReadOnly ?? undefined,
					alwaysAllowReadOnlyOutsideWorkspace: alwaysAllowReadOnlyOutsideWorkspace ?? undefined,
					allowedReadFiles: allowedReadFiles ?? [],
					alwaysAllowWrite: alwaysAllowWrite ?? undefined,
					alwaysAllowWriteOutsideWorkspace: alwaysAllowWriteOutsideWorkspace ?? undefined,
					alwaysAllowWriteProtected: alwaysAllowWriteProtected ?? undefined,
					allowedWriteFiles: allowedWriteFiles ?? [],
					alwaysAllowExecute: alwaysAllowExecute ?? undefined,
					destructiveCommandGuardEnabled: destructiveCommandGuardEnabled ?? false,
					alwaysDenyUnapprovedCommands: alwaysDenyUnapprovedCommands ?? false,
					alwaysAllowMcp,
					alwaysAllowModeSwitch,
					allowedCommands: allowedCommands ?? [],
					deniedCommands: deniedCommands ?? [],
					// Note that we use `null` instead of `undefined` since `JSON.stringify`
					// will omit `undefined` when serializing the object and passing it to the
					// extension host. We may need to do the same for other nullable fields.
					allowedMaxRequests: allowedMaxRequests ?? null,
					allowedMaxCost: allowedMaxCost ?? null,
					autoCondenseContext,
					autoCondenseContextPercent,
					soundEnabled: soundEnabled ?? true,
					soundVolume: soundVolume ?? 0.5,
					ttsEnabled,
					ttsSpeed,
					enableCheckpoints: enableCheckpoints ?? false,
					checkpointTimeout: checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
					writeDelayMs,
					diffFuzzyThreshold,
					terminalShellIntegrationTimeout: terminalShellIntegrationTimeout ?? 30_000,
					terminalShellIntegrationDisabled,
					collapseCommandOutputByDefault,
					terminalCommandDelay,
					terminalPowershellCounter,
					terminalZshClearEolMark,
					terminalZshOhMy,
					terminalZshP10k,
					terminalZdotdir,
					terminalProfile: terminalProfile ?? "", // "" clears a saved profile; undefined is dropped by JSON.stringify
					terminalOutputPreviewSize: terminalOutputPreviewSize ?? "medium",
					mcpEnabled,
					maxOpenTabsContext: Math.min(Math.max(0, maxOpenTabsContext ?? 20), 500),
					maxWorkspaceFiles: Math.min(Math.max(0, maxWorkspaceFiles ?? 200), 500),
					showRooIgnoredFiles: showRooIgnoredFiles ?? true,
					enableSubfolderRules: enableSubfolderRules ?? false,
					maxImageFileSize: maxImageFileSize ?? 5,
					maxTotalImageSize: maxTotalImageSize ?? 20,
					includeDiagnosticMessages:
						includeDiagnosticMessages !== undefined ? includeDiagnosticMessages : true,
					maxDiagnosticMessages: maxDiagnosticMessages ?? 50,
					alwaysAllowSubtasks,
					alwaysAllowFollowupQuestions: alwaysAllowFollowupQuestions ?? false,
					followupAutoApproveTimeoutMs,
					includeTaskHistoryInEnhance: includeTaskHistoryInEnhance ?? true,
					taskTitleGenerationEnabled: taskTitleGenerationEnabled ?? DEFAULT_TASK_TITLE_GENERATION_ENABLED,
					taskTitleApiConfigId: taskTitleApiConfigId ?? "",
					reasoningBlockCollapsed: reasoningBlockCollapsed ?? true,
					chatFontSize: chatFontSize ?? null,
					timeFormat: timeFormat ?? "auto",
					dateFormat: dateFormat ?? "auto",
					showRelativeTimes: showRelativeTimes ?? true,
					enterBehavior: enterBehavior ?? "send",
					includeCurrentTime: includeCurrentTime ?? true,
					includeCurrentCost: includeCurrentCost ?? true,
					maxGitStatusFiles: maxGitStatusFiles ?? 0,
					autoCloseZooOpenedFiles: autoCloseZooOpenedFiles ?? DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES,
					autoCloseZooOpenedFilesAfterUserEdited:
						autoCloseZooOpenedFilesAfterUserEdited ?? DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES_AFTER_USER_EDITED,
					autoCloseZooOpenedNewFiles: autoCloseZooOpenedNewFiles ?? DEFAULT_AUTO_CLOSE_ZOO_OPENED_NEW_FILES,
					profileThresholds,
					imageGenerationProvider,
					openRouterImageApiKey,
					openRouterImageGenerationSelectedModel,
					experiments,
					customSupportPrompts,
				},
			})

			// These have more complex logic so they aren't (yet) handled
			// by the `updateSettings` message.
			vscode.postMessage({ type: "upsertApiConfiguration", text: currentApiConfigName, apiConfiguration })
			vscode.postMessage({ type: "debugSetting", bool: cachedState.debug })

			// With a time or date edit the flag is cleared when the host reports the save (see below). A failed save
			// leaves the user's edits in place to retry.
			if (!saveId) {
				markSettingsSaved(savedSettings)
				markProviderSaved(savedProvider)
				setChangeDetected(false)
			}
		}
	}

	useEffect(() => {
		if (!pendingSaveId) return

		const settle = (success: boolean) => {
			const saved = sentState.current
			if (saved?.id !== pendingSaveId) return
			sentState.current = undefined
			setPendingSaveId(undefined)
			if (success) {
				const settingsUnedited = markSettingsSaved(saved.settings)
				const providerUnedited = markProviderSaved(saved.provider)
				if (settingsUnedited && providerUnedited) setChangeDetected(false)
			}
		}

		const onResult = (event: MessageEvent) => {
			const message = event.data
			if (message?.type !== "settingsSaveResult" || message.requestId !== pendingSaveId) return
			settle(message.success === true)
		}

		window.addEventListener("message", onResult)
		const timer = setTimeout(() => settle(false), SAVE_ANSWER_TIMEOUT_MS)
		return () => {
			clearTimeout(timer)
			window.removeEventListener("message", onResult)
		}
	}, [pendingSaveId, markSettingsSaved, markProviderSaved])

	const checkUnsaveChanges = useCallback(
		(then: () => void) => {
			if (isChangeDetected) {
				confirmDialogHandler.current = then
				setDiscardDialogShow(true)
			} else {
				then()
			}
		},
		[isChangeDetected],
	)

	useImperativeHandle(ref, () => ({ checkUnsaveChanges }), [checkUnsaveChanges])

	const onConfirmDialogResult = useCallback(
		(confirm: boolean) => {
			if (confirm) {
				discardEdits()
				confirmDialogHandler.current?.() // Execute the pending action (e.g., tab switch)
			}
			// If confirm is false (Cancel), do nothing, dialog closes automatically
		},
		[discardEdits],
	)

	// Handle tab changes with unsaved changes check
	const handleTabChange = useCallback(
		(newTab: SectionName) => {
			if (contentRef.current) {
				scrollPositions.current[activeTab] = contentRef.current.scrollTop
			}
			setActiveTab(newTab)
		},
		[activeTab],
	)

	useLayoutEffect(() => {
		if (contentRef.current) {
			contentRef.current.scrollTop = scrollPositions.current[activeTab] ?? 0
		}
	}, [activeTab])

	// Store direct DOM element refs for each tab
	const tabRefs = useRef<Record<SectionName, HTMLButtonElement | null>>(
		Object.fromEntries(sectionNames.map((name) => [name, null])) as Record<SectionName, HTMLButtonElement | null>,
	)

	// Track whether we're in compact mode
	const [isCompactMode, setIsCompactMode] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Setup resize observer to detect when we should switch to compact mode
	useEffect(() => {
		if (!containerRef.current) return

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// If container width is less than 500px, switch to compact mode
				setIsCompactMode(entry.contentRect.width < 500)
			}
		})

		observer.observe(containerRef.current)

		return () => {
			observer?.disconnect()
		}
	}, [])

	const sections: { id: SectionName; icon: LucideIcon }[] = useMemo(
		() => [
			{ id: "providers", icon: Plug },
			{ id: "modes", icon: UsersRound },
			{ id: "skills", icon: GraduationCap },
			{ id: "slashCommands", icon: SquareSlash },
			{ id: "rules", icon: ScrollText },
			{ id: "autoApprove", icon: CheckCheck },
			{ id: "mcp", icon: Server },
			{ id: "checkpoints", icon: GitCommitVertical },
			{ id: "notifications", icon: Bell },
			{ id: "contextManagement", icon: Database },
			{ id: "terminal", icon: SquareTerminal },
			{ id: "prompts", icon: MessageSquare },
			{ id: "worktrees", icon: GitBranch },
			{ id: "ui", icon: Glasses },
			{ id: "experimental", icon: FlaskConical },
			{ id: "language", icon: Globe },
			{ id: "about", icon: Info },
		],
		[], // No dependencies needed now
	)

	// Update target section logic to set active tab
	useEffect(() => {
		if (targetSection && sectionNames.includes(targetSection as SectionName)) {
			setActiveTab(targetSection as SectionName)
		}
	}, [targetSection])

	// Function to scroll the active tab into view for vertical layout
	const scrollToActiveTab = useCallback(() => {
		const activeTabElement = tabRefs.current[activeTab]

		if (activeTabElement) {
			activeTabElement.scrollIntoView({
				behavior: "auto",
				block: "nearest",
			})
		}
	}, [activeTab])

	// Effect to scroll when the active tab changes
	useEffect(() => {
		scrollToActiveTab()
	}, [activeTab, scrollToActiveTab])

	// Effect to scroll when the webview becomes visible
	useLayoutEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "action" && message.action === "didBecomeVisible") {
				scrollToActiveTab()
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [scrollToActiveTab])

	const getSearchIndex = useCallback(() => buildSettingsSearchIndex(sectionNames, t, cachedState), [t, cachedState])

	// Handle search navigation - switch to the correct tab and scroll to the element
	const handleSearchNavigate = useCallback(
		(section: SectionName, settingId: string) => {
			// Switch to the correct tab
			handleTabChange(section)

			// Wait for the tab to render, then find element by settingId and scroll to it
			requestAnimationFrame(() => {
				setTimeout(() => {
					const element = document.querySelector(`[data-setting-id="${settingId}"]`)
					if (element) {
						element.scrollIntoView({ behavior: "smooth", block: "center" })

						// Add highlight animation
						element.classList.add("settings-highlight")
						setTimeout(() => {
							element.classList.remove("settings-highlight")
						}, 1500)
					}
				}, 100) // Small delay to ensure tab content is rendered
			})
		},
		[handleTabChange],
	)

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center gap-2">
				<div className="flex items-center gap-2 grow">
					<StandardTooltip content={t("settings:header.doneButtonTooltip")}>
						<Button variant="ghost" className="px-1.5 -ml-2" onClick={() => checkUnsaveChanges(onDone)}>
							<ArrowLeft />
							<span className="sr-only">{t("settings:common.done")}</span>
						</Button>
					</StandardTooltip>
					<h3 className="text-vscode-foreground m-0 flex-shrink-0">{t("settings:header.title")}</h3>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<SettingsSearch getIndex={getSearchIndex} onNavigate={handleSearchNavigate} sections={sections} />
					<StandardTooltip
						content={
							!isSettingValid
								? errorMessage
								: isChangeDetected
									? t("settings:header.saveButtonTooltip")
									: t("settings:header.nothingChangedTooltip")
						}>
						<Button
							variant={isSettingValid ? "primary" : "secondary"}
							className={!isSettingValid ? "!border-vscode-errorForeground" : ""}
							onClick={handleSubmit}
							disabled={!isChangeDetected || !isSettingValid || !!pendingSaveId}
							data-testid="save-button">
							{t("settings:common.save")}
						</Button>
					</StandardTooltip>
				</div>
			</TabHeader>

			{/* Vertical tabs layout */}
			<div ref={containerRef} className={cn(settingsTabsContainer, isCompactMode && "narrow")}>
				{/* Tab sidebar */}
				<TabList
					value={activeTab}
					onValueChange={(value) => handleTabChange(value as SectionName)}
					className={cn(settingsTabList)}
					data-compact={isCompactMode}
					data-testid="settings-tab-list">
					{sections.map(({ id, icon: Icon }) => {
						const isSelected = id === activeTab
						const onSelect = () => handleTabChange(id)

						// Base TabTrigger component definition
						// We pass isSelected manually for styling, but onSelect is handled conditionally
						const triggerComponent = (
							<TabTrigger
								ref={(element) => (tabRefs.current[id] = element)}
								value={id}
								isSelected={isSelected} // Pass manually for styling state
								className={cn(
									isSelected // Use manual isSelected for styling
										? `${settingsTabTrigger} ${settingsTabTriggerActive}`
										: settingsTabTrigger,
									"cursor-pointer focus:ring-0", // Remove the focus ring styling
								)}
								data-testid={`tab-${id}`}
								data-compact={isCompactMode}>
								<div className={cn("flex items-center gap-2", isCompactMode && "justify-center")}>
									<Icon className="w-4 h-4" />
									<span className="tab-label">{t(`settings:sections.${id}`)}</span>
								</div>
							</TabTrigger>
						)

						if (isCompactMode) {
							// Wrap in Tooltip and manually add onClick to the trigger
							return (
								<TooltipProvider key={id} delayDuration={300}>
									<Tooltip>
										<TooltipTrigger asChild onClick={onSelect}>
											{/* Clone to avoid ref issues if triggerComponent itself had a key */}
											{React.cloneElement(triggerComponent)}
										</TooltipTrigger>
										<TooltipContent side="right" className="text-base">
											<p className="m-0">{t(`settings:sections.${id}`)}</p>
										</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							)
						} else {
							// Render trigger directly; TabList will inject onSelect via cloning
							// Ensure the element passed to TabList has the key
							return React.cloneElement(triggerComponent, { key: id })
						}
					})}
				</TabList>

				{/* Content area */}
				<TabContent ref={contentRef} className="p-0 flex-1 overflow-auto" data-testid="settings-content">
					{/* Providers Section */}
					{activeTab === "providers" && (
						<div>
							<SectionHeader>{t("settings:sections.providers")}</SectionHeader>

							<Section>
								<ApiConfigManager
									currentApiConfigName={currentApiConfigName}
									listApiConfigMeta={listApiConfigMeta}
									onSelectConfig={(configName: string) =>
										checkUnsaveChanges(() =>
											vscode.postMessage({ type: "loadApiConfiguration", text: configName }),
										)
									}
									onDeleteConfig={(configName: string) =>
										vscode.postMessage({ type: "deleteApiConfiguration", text: configName })
									}
									onRenameConfig={(oldName: string, newName: string) => {
										vscode.postMessage({
											type: "renameApiConfiguration",
											values: { oldName, newName },
											apiConfiguration,
										})
										prevApiConfigName.current = newName
									}}
									onUpsertConfig={(configName: string) =>
										vscode.postMessage({
											type: "upsertApiConfiguration",
											text: configName,
											apiConfiguration,
										})
									}
								/>
								<ApiOptions
									uriScheme={uriScheme}
									apiConfiguration={apiConfiguration}
									setApiConfigurationField={setApiConfigurationField}
									errorMessage={errorMessage}
									setErrorMessage={setErrorMessage}
								/>
								{apiConfiguration.apiProvider === providerIdentifiers.museCode && (
									<div className="flex flex-col gap-1">
										<label htmlFor={quotaFallbackControlId} className="font-medium">
											{t("settings:providers.cliSubscription.quotaFallbackLabel")}
										</label>
										<select
											id={quotaFallbackControlId}
											aria-describedby={quotaFallbackDescriptionId}
											className="w-full rounded border border-vscode-input-border bg-vscode-input-background px-2 py-1 text-vscode-input-foreground"
											value={quotaFallbackId}
											onChange={(event) =>
												setApiConfigurationField(
													"museCodeQuotaFallbackProfileId",
													event.target.value || undefined,
												)
											}>
											<option value="">
												{t("settings:providers.cliSubscription.quotaFallbackOff")}
											</option>
											{quotaFallbackId && !hasQuotaFallback && (
												<option value={quotaFallbackId}>
													{t("settings:providers.cliSubscription.quotaFallbackUnavailable")}
												</option>
											)}
											{quotaFallbackProfiles.map(({ id, name }) => (
												<option key={id} value={id}>
													{name}
												</option>
											))}
										</select>
										<span
											id={quotaFallbackDescriptionId}
											className="text-sm text-vscode-descriptionForeground">
											{t("settings:providers.cliSubscription.quotaFallbackDescription")}
										</span>
										{hasQuotaFallback && (
											<>
												<label className="mt-2 flex items-center gap-2">
													<Checkbox
														checked={
															apiConfiguration.museCodeQuotaFallbackAfterPartialReply ??
															false
														}
														onCheckedChange={(checked) =>
															setApiConfigurationField(
																"museCodeQuotaFallbackAfterPartialReply",
																checked === true,
															)
														}
													/>
													{t(
														"settings:providers.cliSubscription.quotaFallbackAfterPartialReply",
													)}
												</label>
												<span className="text-sm text-vscode-descriptionForeground">
													{t(
														"settings:providers.cliSubscription.quotaFallbackAfterPartialReplyDescription",
													)}
												</span>
											</>
										)}
									</div>
								)}
							</Section>
						</div>
					)}

					{/* Auto-Approve Section */}
					{activeTab === "autoApprove" && (
						<AutoApproveSettings
							alwaysAllowReadOnly={alwaysAllowReadOnly}
							alwaysAllowReadOnlyOutsideWorkspace={alwaysAllowReadOnlyOutsideWorkspace}
							allowedReadFiles={allowedReadFiles}
							alwaysAllowWrite={alwaysAllowWrite}
							alwaysAllowWriteOutsideWorkspace={alwaysAllowWriteOutsideWorkspace}
							alwaysAllowWriteProtected={alwaysAllowWriteProtected}
							allowedWriteFiles={allowedWriteFiles}
							alwaysAllowMcp={alwaysAllowMcp}
							alwaysAllowModeSwitch={alwaysAllowModeSwitch}
							alwaysAllowSubtasks={alwaysAllowSubtasks}
							alwaysAllowExecute={alwaysAllowExecute}
							destructiveCommandGuardEnabled={destructiveCommandGuardEnabled}
							alwaysDenyUnapprovedCommands={alwaysDenyUnapprovedCommands}
							alwaysAllowFollowupQuestions={alwaysAllowFollowupQuestions}
							followupAutoApproveTimeoutMs={followupAutoApproveTimeoutMs}
							allowedCommands={allowedCommands}
							allowedMaxRequests={allowedMaxRequests ?? undefined}
							allowedMaxCost={allowedMaxCost ?? undefined}
							deniedCommands={deniedCommands}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Slash Commands Section */}
					{activeTab === "slashCommands" && <SlashCommandsSettings />}

					{/* Skills Section */}
					{activeTab === "skills" && <SkillsSettings />}

					{/* Rules Section */}
					{activeTab === "rules" && <RulesSettings />}

					{/* Checkpoints Section */}
					{activeTab === "checkpoints" && (
						<CheckpointSettings
							enableCheckpoints={enableCheckpoints}
							checkpointTimeout={checkpointTimeout}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Notifications Section */}
					{activeTab === "notifications" && (
						<NotificationSettings
							ttsEnabled={ttsEnabled}
							ttsSpeed={ttsSpeed}
							soundEnabled={soundEnabled}
							soundVolume={soundVolume}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Context Management Section */}
					{activeTab === "contextManagement" && (
						<ContextManagementSettings
							autoCondenseContext={autoCondenseContext}
							autoCondenseContextPercent={autoCondenseContextPercent}
							listApiConfigMeta={listApiConfigMeta ?? []}
							maxOpenTabsContext={maxOpenTabsContext}
							maxWorkspaceFiles={maxWorkspaceFiles ?? 200}
							showRooIgnoredFiles={showRooIgnoredFiles}
							enableSubfolderRules={enableSubfolderRules}
							maxImageFileSize={maxImageFileSize}
							maxTotalImageSize={maxTotalImageSize}
							profileThresholds={profileThresholds}
							includeDiagnosticMessages={includeDiagnosticMessages}
							maxDiagnosticMessages={maxDiagnosticMessages}
							writeDelayMs={writeDelayMs}
							diffFuzzyThreshold={diffFuzzyThreshold}
							includeCurrentTime={includeCurrentTime}
							includeCurrentCost={includeCurrentCost}
							maxGitStatusFiles={maxGitStatusFiles}
							customSupportPrompts={customSupportPrompts || {}}
							setCustomSupportPrompts={setCustomSupportPromptsField}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Terminal Section */}
					{activeTab === "terminal" && (
						<TerminalSettings
							terminalOutputPreviewSize={terminalOutputPreviewSize}
							terminalShellIntegrationTimeout={terminalShellIntegrationTimeout}
							terminalShellIntegrationDisabled={terminalShellIntegrationDisabled}
							collapseCommandOutputByDefault={collapseCommandOutputByDefault}
							terminalCommandDelay={terminalCommandDelay}
							terminalPowershellCounter={terminalPowershellCounter}
							terminalZshClearEolMark={terminalZshClearEolMark}
							terminalZshOhMy={terminalZshOhMy}
							terminalZshP10k={terminalZshP10k}
							terminalZdotdir={terminalZdotdir}
							terminalProfile={terminalProfile}
							onTerminalProfilePickerOpened={() => setChangeDetected(true)}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Modes Section */}
					{activeTab === "modes" && <ModesView />}

					{/* MCP Section */}
					{activeTab === "mcp" && (
						<McpView
							mcpEnabled={mcpEnabled}
							setMcpEnabled={(value) => setCachedStateField("mcpEnabled", value)}
						/>
					)}

					{/* Worktrees Section */}
					{activeTab === "worktrees" && <WorktreesView />}

					{/* Prompts Section */}
					{activeTab === "prompts" && (
						<PromptsSettings
							customSupportPrompts={customSupportPrompts || {}}
							setCustomSupportPrompts={setCustomSupportPromptsField}
							includeTaskHistoryInEnhance={includeTaskHistoryInEnhance}
							setIncludeTaskHistoryInEnhance={(value) =>
								setCachedStateField("includeTaskHistoryInEnhance", value)
							}
							taskTitleGenerationEnabled={
								taskTitleGenerationEnabled ?? DEFAULT_TASK_TITLE_GENERATION_ENABLED
							}
							setTaskTitleGenerationEnabled={(value) =>
								setCachedStateField("taskTitleGenerationEnabled", value)
							}
							taskTitleApiConfigId={taskTitleApiConfigId}
							setTaskTitleApiConfigId={(value) => setCachedStateField("taskTitleApiConfigId", value)}
						/>
					)}

					{/* UI Section */}
					{activeTab === "ui" && (
						<UISettings
							reasoningBlockCollapsed={reasoningBlockCollapsed ?? true}
							enterBehavior={enterBehavior ?? "send"}
							chatFontSize={chatFontSize ?? undefined}
							autoCloseZooOpenedFiles={autoCloseZooOpenedFiles}
							autoCloseZooOpenedFilesAfterUserEdited={autoCloseZooOpenedFilesAfterUserEdited}
							autoCloseZooOpenedNewFiles={autoCloseZooOpenedNewFiles}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Experimental Section */}
					{activeTab === "experimental" && (
						<ExperimentalSettings
							setExperimentEnabled={setExperimentEnabled}
							experiments={experiments}
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							imageGenerationProvider={imageGenerationProvider}
							openRouterImageApiKey={openRouterImageApiKey as string | undefined}
							openRouterImageGenerationSelectedModel={
								openRouterImageGenerationSelectedModel as string | undefined
							}
							setImageGenerationProvider={setImageGenerationProvider}
							setOpenRouterImageApiKey={setOpenRouterImageApiKey}
							setImageGenerationSelectedModel={setImageGenerationSelectedModel}
						/>
					)}

					{/* Language Section */}
					{activeTab === "language" && (
						<LanguageSettings
							language={language || "en"}
							timeFormat={timeFormat}
							dateFormat={dateFormat}
							showRelativeTimes={showRelativeTimes}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* About Section */}
					{activeTab === "about" && <About debug={cachedState.debug} setDebug={setDebug} />}
				</TabContent>
			</div>

			<AlertDialog open={isDiscardDialogShow} onOpenChange={setDiscardDialogShow}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<TriangleAlert className="w-5 h-5 text-yellow-500" />
							{t("settings:unsavedChangesDialog.title")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t("settings:unsavedChangesDialog.description")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => onConfirmDialogResult(false)}>
							{t("settings:unsavedChangesDialog.cancelButton")}
						</AlertDialogCancel>
						<AlertDialogAction onClick={() => onConfirmDialogResult(true)}>
							{t("settings:unsavedChangesDialog.discardButton")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Tab>
	)
})

export default SettingsView
