// Dispatch tool calls to their handlers, with checkpoints at the same execution boundaries.
// Extracted from presentAssistantMessage.ts.

import { customToolRegistry } from "@roo-code/core"

import { t } from "../../i18n"

import type { ToolUse } from "../../shared/tools"
import type { Task } from "../task/Task"
import { listFilesTool } from "../tools/ListFilesTool"
import { readFileTool } from "../tools/ReadFileTool"
import { readCommandOutputTool } from "../tools/ReadCommandOutputTool"
import { writeToFileTool } from "../tools/WriteToFileTool"
import { editTool } from "../tools/EditTool"
import { searchReplaceTool } from "../tools/SearchReplaceTool"
import { editFileTool } from "../tools/EditFileTool"
import { applyPatchTool } from "../tools/ApplyPatchTool"
import { searchFilesTool } from "../tools/SearchFilesTool"
import { executeCommandTool } from "../tools/ExecuteCommandTool"
import { useMcpToolTool } from "../tools/UseMcpToolTool"
import { accessMcpResourceTool } from "../tools/accessMcpResourceTool"
import { askFollowupQuestionTool } from "../tools/AskFollowupQuestionTool"
import { switchModeTool } from "../tools/SwitchModeTool"
import { attemptCompletionTool, AttemptCompletionCallbacks } from "../tools/AttemptCompletionTool"
import { newTaskTool } from "../tools/NewTaskTool"
import { updateTodoListTool } from "../tools/UpdateTodoListTool"
import { runSlashCommandTool } from "../tools/RunSlashCommandTool"
import { skillTool } from "../tools/SkillTool"
import { generateImageTool } from "../tools/GenerateImageTool"
import { applyDiffTool as applyDiffToolClass } from "../tools/ApplyDiffTool"
import { codebaseSearchTool } from "../tools/CodebaseSearchTool"

import { formatResponse } from "../prompts/responses"
import { sanitizeToolUseId } from "../../utils/tool-id"

export async function dispatchToolUse(
	cline: Task,
	block: ToolUse,
	stateExperiments: Record<string, boolean> | undefined,
	taskMode: string,
	callbacks: AttemptCompletionCallbacks,
	isCurrent: () => boolean,
): Promise<void> {
	const { askApproval, handleError, pushToolResult, askFinishSubTaskApproval, toolDescription, toolCallId } =
		callbacks
	switch (block.name) {
		case "write_to_file":
			await checkpointSaveAndMark(cline, isCurrent)
			if (!isCurrent()) return
			await writeToFileTool.handle(cline, block as ToolUse<"write_to_file">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "update_todo_list":
			await updateTodoListTool.handle(cline, block as ToolUse<"update_todo_list">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "apply_diff":
			await checkpointSaveAndMark(cline, isCurrent)
			if (!isCurrent()) return
			await applyDiffToolClass.handle(cline, block as ToolUse<"apply_diff">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "edit":
		case "search_and_replace":
			await checkpointSaveAndMark(cline, isCurrent)
			if (!isCurrent()) return
			await editTool.handle(cline, block as ToolUse<"edit">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "search_replace":
			await checkpointSaveAndMark(cline, isCurrent)
			if (!isCurrent()) return
			await searchReplaceTool.handle(cline, block as ToolUse<"search_replace">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "edit_file":
			await checkpointSaveAndMark(cline, isCurrent)
			if (!isCurrent()) return
			await editFileTool.handle(cline, block as ToolUse<"edit_file">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "apply_patch":
			await checkpointSaveAndMark(cline, isCurrent)
			if (!isCurrent()) return
			await applyPatchTool.handle(cline, block as ToolUse<"apply_patch">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "read_file":
			// Type assertion is safe here because we're in the "read_file" case
			await readFileTool.handle(cline, block as ToolUse<"read_file">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "list_files":
			await listFilesTool.handle(cline, block as ToolUse<"list_files">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "codebase_search":
			await codebaseSearchTool.handle(cline, block as ToolUse<"codebase_search">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "search_files":
			await searchFilesTool.handle(cline, block as ToolUse<"search_files">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "execute_command":
			await executeCommandTool.handle(cline, block as ToolUse<"execute_command">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "read_command_output":
			await readCommandOutputTool.handle(cline, block as ToolUse<"read_command_output">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "use_mcp_tool":
			await useMcpToolTool.handle(cline, block as ToolUse<"use_mcp_tool">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "access_mcp_resource":
			await accessMcpResourceTool.handle(cline, block as ToolUse<"access_mcp_resource">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "ask_followup_question":
			await askFollowupQuestionTool.handle(cline, block as ToolUse<"ask_followup_question">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "switch_mode":
			await switchModeTool.handle(cline, block as ToolUse<"switch_mode">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "new_task":
			await checkpointSaveAndMark(cline, isCurrent)
			if (!isCurrent()) return
			await newTaskTool.handle(cline, block as ToolUse<"new_task">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "attempt_completion": {
			const completionCallbacks: AttemptCompletionCallbacks = {
				askApproval,
				handleError,
				pushToolResult,
				askFinishSubTaskApproval,
				toolDescription,
				toolCallId,
			}
			await attemptCompletionTool.handle(cline, block as ToolUse<"attempt_completion">, completionCallbacks)
			break
		}
		case "run_slash_command":
			await runSlashCommandTool.handle(cline, block as ToolUse<"run_slash_command">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "skill":
			await skillTool.handle(cline, block as ToolUse<"skill">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		case "generate_image":
			await checkpointSaveAndMark(cline, isCurrent)
			if (!isCurrent()) return
			await generateImageTool.handle(cline, block as ToolUse<"generate_image">, {
				askApproval,
				handleError,
				pushToolResult,
				toolCallId,
			})
			break
		default: {
			// Handle unknown/invalid tool names OR custom tools
			// This is critical for native tool calling where every tool_use MUST have a tool_result

			// CRITICAL: Don't process partial blocks for unknown tools - just let them stream in.
			// If we try to show errors for partial blocks, we'd show the error on every streaming chunk,
			// creating a loop that appears to freeze the extension. Only handle complete blocks.
			if (block.partial) {
				break
			}

			const customTool = stateExperiments?.customTools ? customToolRegistry.get(block.name) : undefined

			if (customTool) {
				try {
					let customToolArgs

					if (customTool.parameters) {
						try {
							customToolArgs = customTool.parameters.parse(block.nativeArgs || block.params || {})
						} catch (parseParamsError) {
							const message = `Custom tool "${block.name}" argument validation failed: ${parseParamsError.message}`
							console.error(message)
							cline.consecutiveMistakeCount++
							await cline.say("error", message)
							pushToolResult(formatResponse.toolError(message))
							break
						}
					}

					const result = await customTool.execute(customToolArgs, {
						mode: taskMode,
						task: cline,
					})
					if (!isCurrent()) return

					// Log only the tool name. Arguments and results can hold file contents or secrets.
					console.log(`${customTool.name}.execute() completed`)

					pushToolResult(result)
					cline.consecutiveMistakeCount = 0
				} catch (executionError) {
					if (!isCurrent()) return
					cline.consecutiveMistakeCount++
					// Record custom tool error with static name
					cline.recordToolError("custom_tool", executionError.message)
					await handleError(`executing custom tool "${block.name}"`, executionError)
				}

				break
			}

			// Not a custom tool - handle as unknown tool error
			const errorMessage = `Unknown tool "${block.name}". This tool does not exist. Please use one of the available tools.`
			cline.consecutiveMistakeCount++
			cline.recordToolError("invalid_tool_call", errorMessage)
			await cline.say("error", t("tools:unknownToolError", { toolName: block.name }))
			if (!isCurrent()) return
			// Push tool_result directly WITHOUT setting didAlreadyUseTool
			// This prevents the stream from being interrupted with "Response interrupted by tool use result"
			cline.pushToolResultToUserContent({
				type: "tool_result",
				tool_use_id: sanitizeToolUseId(toolCallId),
				content: formatResponse.toolError(errorMessage),
				is_error: true,
			})
			break
		}
	}
}

/**
 * save checkpoint and mark done in the current streaming task.
 * @param task The Task instance to checkpoint save and mark.
 * @returns
 */
async function checkpointSaveAndMark(task: Task, isCurrent: () => boolean) {
	if (task.currentStreamingDidCheckpoint) {
		return
	}
	try {
		await task.checkpointSave(true)
		if (isCurrent()) task.currentStreamingDidCheckpoint = true
	} catch (error) {
		console.error(`[Task#presentAssistantMessage] Error saving checkpoint: ${error.message}`, error)
	}
}
