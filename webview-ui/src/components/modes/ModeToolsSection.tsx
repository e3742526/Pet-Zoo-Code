// Render the mode tool groups and the per-mode MCP restriction editor.
// Extracted from ModesView.tsx.

import { useCallback } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import type { GroupEntry, ToolGroup, McpServer, ModeConfig } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip } from "@src/components/ui"

import McpServerRestriction from "./McpServerRestriction"
import { availableGroups, getGroupName } from "./modeToolGroups"

type ModeToolsSectionProps = {
	customMode?: ModeConfig
	getCurrentMode: () => ModeConfig | undefined
	isToolsEditMode: boolean
	setIsToolsEditMode: (editing: boolean) => void
	mcpServers: McpServer[]
	updateCustomMode: (slug: string, mode: ModeConfig) => void
}

export function ModeToolsSection({
	customMode,
	getCurrentMode,
	isToolsEditMode,
	setIsToolsEditMode,
	mcpServers,
	updateCustomMode,
}: ModeToolsSectionProps) {
	const { t } = useAppTranslation()
	// Handler for group checkbox changes
	const handleGroupChange = useCallback(
		(group: ToolGroup, mode: ModeConfig) => (e: Event | React.FormEvent<HTMLElement>) => {
			const target = (e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
			const checked = target.checked
			const oldGroups = mode.groups || []
			let newGroups: GroupEntry[]
			if (checked) {
				newGroups = [...oldGroups, group]
			} else {
				newGroups = oldGroups.filter((g) => getGroupName(g) !== group)
			}
			updateCustomMode(mode.slug, {
				...mode,
				groups: newGroups,
				source: mode.source || "global",
			})
		},
		[updateCustomMode],
	)

	return (
		<div className="mb-4">
			<div className="flex justify-between items-center mb-1">
				<div className="font-bold">{t("prompts:tools.title")}</div>
				{customMode && (
					<StandardTooltip
						content={isToolsEditMode ? t("prompts:tools.doneEditing") : t("prompts:tools.editTools")}>
						<Button variant="ghost" size="icon" onClick={() => setIsToolsEditMode(!isToolsEditMode)}>
							<span className={`codicon codicon-${isToolsEditMode ? "check" : "edit"}`}></span>
						</Button>
					</StandardTooltip>
				)}
			</div>
			{!customMode && (
				<div className="text-sm text-vscode-descriptionForeground mb-2">
					{t("prompts:tools.builtInModesText")}
				</div>
			)}
			{isToolsEditMode && customMode ? (
				<>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
						{availableGroups.map((group) => (
							<VSCodeCheckbox
								key={group}
								checked={customMode.groups?.some((entry) => getGroupName(entry) === group)}
								onChange={handleGroupChange(group, customMode)}>
								{t(`prompts:tools.toolNames.${group}`)}
								{group === "edit" && (
									<div className="text-xs text-vscode-descriptionForeground mt-0.5">
										{t("prompts:tools.allowedFiles")}{" "}
										{(() => {
											const currentMode = getCurrentMode()
											const editGroup = currentMode?.groups?.find(
												(g) => Array.isArray(g) && g[0] === "edit" && g[1]?.fileRegex,
											)
											if (!Array.isArray(editGroup)) return t("prompts:allFiles")
											return editGroup[1].description || `/${editGroup[1].fileRegex}/`
										})()}
									</div>
								)}
							</VSCodeCheckbox>
						))}
					</div>
					{/* MCP Server Restriction - shown when mcp group is enabled.
					    Extracted into McpServerRestriction so it can use a local
					    cached-state buffer + 150 ms debounced flush. This avoids
					    the host round-trip flicker where the toggle and the
					    `mcp-server-list` subtree would snap back / unmount between
					    a click and the host echo. See McpServerRestriction.tsx. */}
					{(() => {
						const isMcpEnabled = customMode.groups?.some((g) => getGroupName(g) === "mcp")
						if (!isMcpEnabled) return null
						return (
							<McpServerRestriction
								customMode={customMode}
								mcpServers={mcpServers}
								onCommit={updateCustomMode}
							/>
						)
					})()}
				</>
			) : (
				<div className="text-sm text-vscode-foreground mb-2 leading-relaxed">
					{(() => {
						const currentMode = getCurrentMode()
						const enabledGroups = currentMode?.groups || []

						// If there are no enabled groups, display translated "None"
						if (enabledGroups.length === 0) {
							return t("prompts:tools.noTools")
						}

						return enabledGroups
							.map((group) => {
								const groupName = getGroupName(group)
								const displayName = t(`prompts:tools.toolNames.${groupName}`)
								if (Array.isArray(group) && group[1]?.fileRegex) {
									const description = group[1].description || `/${group[1].fileRegex}/`
									return `${displayName} (${description})`
								}
								return displayName
							})
							.join(", ")
					})()}
				</div>
			)}
		</div>
	)
}
