// Format tool descriptions for approval and rejection messages.
// Extracted from presentAssistantMessage.ts.

import type { ModeConfig, ReadFileParams } from "@roo-code/types"
import { defaultModeSlug, getModeBySlug } from "../../shared/modes"
import type { ToolUse } from "../../shared/tools"
import { readFileTool } from "../tools/ReadFileTool"

export function describeToolUse(block: ToolUse, customModes: ModeConfig[] | undefined): string {
	switch (block.name) {
		case "execute_command":
			return `[${block.name} for '${block.params.command}']`
		case "read_file":
			// Prefer native typed args when available; fall back to legacy params
			// Check if nativeArgs exists (native protocol)
			if (block.nativeArgs) {
				// The formatter also accepts legacy native arguments and supplies its own path fallback.
				return readFileTool.getReadFileToolDescription(block.name, block.nativeArgs as ReadFileParams)
			}
			return readFileTool.getReadFileToolDescription(block.name, block.params)
		case "write_to_file":
			return `[${block.name} for '${block.params.path}']`
		case "apply_diff":
			// Native-only: tool args are structured (no XML payloads).
			return block.params?.path ? `[${block.name} for '${block.params.path}']` : `[${block.name}]`
		case "search_files":
			return `[${block.name} for '${block.params.regex}'${
				block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
			}]`
		case "edit":
		case "search_and_replace":
			return `[${block.name} for '${block.params.file_path}']`
		case "search_replace":
			return `[${block.name} for '${block.params.file_path}']`
		case "edit_file":
			return `[${block.name} for '${block.params.file_path}']`
		case "apply_patch":
			return `[${block.name}]`
		case "list_files":
			return `[${block.name} for '${block.params.path}']`
		case "use_mcp_tool":
			return `[${block.name} for '${block.params.server_name}']`
		case "access_mcp_resource":
			return `[${block.name} for '${block.params.server_name}']`
		case "ask_followup_question":
			return `[${block.name} for '${block.params.question}']`
		case "attempt_completion":
			return `[${block.name}]`
		case "switch_mode":
			return `[${block.name} to '${block.params.mode_slug}'${block.params.reason ? ` because: ${block.params.reason}` : ""}]`
		case "codebase_search":
			return `[${block.name} for '${block.params.query}']`
		case "read_command_output":
			return `[${block.name} for '${block.params.artifact_id}']`
		case "update_todo_list":
			return `[${block.name}]`
		case "new_task": {
			const mode = block.params.mode ?? defaultModeSlug
			const message = block.params.message ?? "(no message)"
			const modeName = getModeBySlug(mode, customModes)?.name ?? mode
			return `[${block.name} in ${modeName} mode: '${message}']`
		}
		case "run_slash_command":
			return `[${block.name} for '${block.params.command}'${block.params.args ? ` with args: ${block.params.args}` : ""}]`
		case "skill":
			return `[${block.name} for '${block.params.skill}'${block.params.args ? ` with args: ${block.params.args}` : ""}]`
		case "generate_image":
			return `[${block.name} for '${block.params.path}']`
		default:
			return `[${block.name}]`
	}
}
