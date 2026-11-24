import type { TFunction } from "i18next"

import type { ExtensionState } from "@roo-code/types"
import { EXPERIMENT_IDS, experimentConfigsMap } from "@roo/experiments"

import type { SectionName } from "./SettingsView"
import type { SearchableSettingData } from "./useSettingsSearch"

type SearchSettingsState = Pick<
	ExtensionState,
	| "alwaysAllowReadOnly"
	| "alwaysAllowWrite"
	| "alwaysAllowFollowupQuestions"
	| "alwaysAllowExecute"
	| "destructiveCommandGuardEnabled"
	| "enableCheckpoints"
	| "ttsEnabled"
	| "soundEnabled"
	| "terminalShellIntegrationDisabled"
>

type SettingDefinition = readonly [
	label: string | ((t: TFunction) => string),
	isVisible?: (state: SearchSettingsState) => boolean,
]

const hasCommandLists = (state: SearchSettingsState) =>
	!!state.alwaysAllowExecute && !state.destructiveCommandGuardEnabled
const hasTerminalShellIntegration = (state: SearchSettingsState) => state.terminalShellIntegrationDisabled === false

export const getPrimaryModifier = () => (navigator.platform.toUpperCase().includes("MAC") ? "⌘" : "Ctrl")

// Use these IDs in SearchableSetting so search can find the matching control without mounting its section.
const settings = {
	autoApprove: {
		"auto-approve-enabled": ["settings:autoApprove.enabled"],
		"auto-approve-readonly-outside-workspace": [
			"settings:autoApprove.readOnly.outsideWorkspace.label",
			(state) => !!state.alwaysAllowReadOnly,
		],
		"auto-approve-write-outside-workspace": [
			"settings:autoApprove.write.outsideWorkspace.label",
			(state) => !!state.alwaysAllowWrite,
		],
		"auto-approve-write-protected": [
			"settings:autoApprove.write.protected.label",
			(state) => !!state.alwaysAllowWrite,
		],
		"auto-approve-allowed-read-files": ["settings:autoApprove.allowlists.readFiles.label"],
		"auto-approve-allowed-write-files": ["settings:autoApprove.allowlists.writeFiles.label"],
		"auto-approve-followup-timeout": [
			"settings:autoApprove.followupQuestions.timeoutLabel",
			(state) => !!state.alwaysAllowFollowupQuestions,
		],
		"auto-approve-destructive-command-guard": [
			"settings:autoApprove.execute.destructiveCommandGuard.label",
			(state) => !!state.alwaysAllowExecute,
		],
		"auto-approve-auto-deny-unapproved": [
			"settings:autoApprove.execute.autoDeny.label",
			(state) => !!state.alwaysAllowExecute,
		],
		"auto-approve-allowed-commands": ["settings:autoApprove.execute.allowedCommands", hasCommandLists],
		"auto-approve-denied-commands": ["settings:autoApprove.execute.deniedCommands", hasCommandLists],
	},
	checkpoints: {
		"checkpoints-enable": ["settings:checkpoints.enable.label"],
		"checkpoints-timeout": ["settings:checkpoints.timeout.label", (state) => !!state.enableCheckpoints],
	},
	notifications: {
		"notifications-tts": ["settings:notifications.tts.label"],
		"notifications-tts-speed": ["settings:notifications.tts.speedLabel", (state) => !!state.ttsEnabled],
		"notifications-sound": ["settings:notifications.sound.label"],
		"notifications-sound-volume": ["settings:notifications.sound.volumeLabel", (state) => !!state.soundEnabled],
	},
	contextManagement: {
		"context-open-tabs": ["settings:contextManagement.openTabs.label"],
		"context-workspace-files": ["settings:contextManagement.workspaceFiles.label"],
		"context-max-git-status-files": ["settings:contextManagement.maxGitStatusFiles.label"],
		"context-show-rooignored-files": ["settings:contextManagement.rooignore.label"],
		"context-enable-subfolder-rules": ["settings:contextManagement.enableSubfolderRules.label"],
		"context-max-image-file-size": ["settings:contextManagement.maxImageFileSize.label"],
		"context-max-total-image-size": ["settings:contextManagement.maxTotalImageSize.label"],
		"context-include-diagnostic-messages": ["settings:contextManagement.diagnostics.includeMessages.label"],
		"context-max-diagnostic-messages": ["settings:contextManagement.diagnostics.maxMessages.label"],
		"context-write-delay": ["settings:contextManagement.diagnostics.delayAfterWrite.label"],
		"context-diff-fuzzy-threshold": ["settings:contextManagement.fileEdits.diffFuzzyThreshold.label"],
		"context-include-current-time": ["settings:contextManagement.includeCurrentTime.label"],
		"context-include-current-cost": ["settings:contextManagement.includeCurrentCost.label"],
		"context-condense-prompt": ["prompts:supportPrompts.types.CONDENSE.label"],
		"context-auto-condense": ["settings:contextManagement.autoCondenseContext.name"],
	},
	terminal: {
		"terminal-output-preview-size": ["settings:terminal.outputPreviewSize.label"],
		"terminal-collapse-command-output": ["settings:terminal.collapseCommandOutput.label"],
		"terminal-shell-integration-disabled": ["settings:terminal.shellIntegrationDisabled.label"],
		"terminal-profile": ["settings:terminal.profile.label", hasTerminalShellIntegration],
		"terminal-inherit-env": ["settings:terminal.inheritEnv.label", hasTerminalShellIntegration],
		"terminal-shell-integration-timeout": [
			"settings:terminal.shellIntegrationTimeout.label",
			hasTerminalShellIntegration,
		],
		"terminal-command-delay": ["settings:terminal.commandDelay.label", hasTerminalShellIntegration],
		"terminal-powershell-counter": ["settings:terminal.powershellCounter.label", hasTerminalShellIntegration],
		"terminal-zsh-clear-eol-mark": ["settings:terminal.zshClearEolMark.label", hasTerminalShellIntegration],
		"terminal-zsh-oh-my": ["settings:terminal.zshOhMy.label", hasTerminalShellIntegration],
		"terminal-zsh-p10k": ["settings:terminal.zshP10k.label", hasTerminalShellIntegration],
		"terminal-zdotdir": ["settings:terminal.zdotdir.label", hasTerminalShellIntegration],
	},
	prompts: {
		"prompts-support-prompt-select": ["settings:sections.prompts"],
	},
	ui: {
		"ui-collapse-thinking": ["settings:ui.collapseThinking.label"],
		"ui-enter-behavior": [
			(t) => t("settings:ui.requireCtrlEnterToSend.label", { primaryMod: getPrimaryModifier() }),
		],
		"ui-chat-font-size": ["settings:ui.chatFontSize.label"],
		"ui-auto-close-zoo-opened-files": ["settings:ui.autoCloseZooOpenedFiles.label"],
		"ui-auto-close-zoo-opened-files-after-user-edited": [
			"settings:ui.autoCloseZooOpenedFilesAfterUserEdited.label",
		],
		"ui-auto-close-zoo-opened-new-files": ["settings:ui.autoCloseZooOpenedNewFiles.label"],
	},
	language: {
		"language-select": ["settings:sections.language"],
		"language-time-format": ["settings:language.timeFormat.label"],
		"language-date-format": ["settings:language.dateFormat.label"],
		"language-relative-times": ["settings:language.relativeTimes.label"],
	},
	about: {
		"about-debug-mode": ["settings:about.debugMode.label"],
		"about-manage-settings": ["settings:about.manageSettings"],
		"about-import-roo-history": ["settings:about.rooHistoryImport.settingLabel"],
	},
} satisfies Partial<Record<SectionName, Record<string, SettingDefinition>>>

type StaticSettingId = { [K in keyof typeof settings]: keyof (typeof settings)[K] }[keyof typeof settings]
type ExperimentKey = keyof typeof EXPERIMENT_IDS
type ExperimentalSettingId = `experimental-${Lowercase<ExperimentKey>}`

export type SearchableSettingId = StaticSettingId | ExperimentalSettingId

export const visibleSettingsExperiments = (Object.keys(experimentConfigsMap) as ExperimentKey[]).filter(
	(key) => experimentConfigsMap[key].showInSettings !== false,
)

export function getExperimentSettingId(key: ExperimentKey): ExperimentalSettingId {
	return `experimental-${key.toLowerCase()}` as ExperimentalSettingId
}

const settingsBySection: Partial<Record<SectionName, Record<string, SettingDefinition>>> = settings

export function buildSettingsSearchIndex(
	sections: readonly SectionName[],
	t: TFunction,
	state: SearchSettingsState,
): SearchableSettingData[] {
	const sectionLabels = sections.map((section) => ({ section, sectionLabel: t(`settings:sections.${section}`) }))
	const settingsIndex = sectionLabels.flatMap<SearchableSettingData>(({ section, sectionLabel }) => {
		if (section === "experimental") {
			return visibleSettingsExperiments.map((key) => ({
				settingId: getExperimentSettingId(key),
				section,
				sectionLabel,
				label: t(`settings:experimental.${key}.name`),
			}))
		}

		return Object.entries(settingsBySection[section] ?? {})
			.filter(([, [, isVisible]]) => isVisible?.(state) ?? true)
			.map(([settingId, [label]]) => ({
				settingId,
				section,
				sectionLabel,
				label: typeof label === "string" ? t(label) : label(t),
			}))
	})

	return [
		...settingsIndex,
		...sectionLabels.map(({ section, sectionLabel }) => ({
			settingId: `tab-${section}`,
			section,
			sectionLabel,
			label: sectionLabel,
		})),
	]
}
