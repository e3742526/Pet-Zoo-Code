// Share selectable tool groups and read both supported group entry formats.
// Extracted from ModesView.tsx.

import type { GroupEntry, ToolGroup } from "@roo-code/types"

import { TOOL_GROUPS } from "@roo/tools"

// Get all available groups that should show in prompts view
export const availableGroups = (Object.keys(TOOL_GROUPS) as ToolGroup[]).filter(
	(group) => !TOOL_GROUPS[group].alwaysAvailable,
)

// Helper to get group name regardless of format
export function getGroupName(group: GroupEntry): ToolGroup {
	return Array.isArray(group) ? group[0] : group
}
