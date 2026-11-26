// Adapt native MCP calls to the tool handler and send approval feedback and results.
// Extracted from presentAssistantMessage.ts.

import { markToolRejected } from "../task/toolExecutionContext"
import { serializeError } from "serialize-error"
import { Anthropic } from "@anthropic-ai/sdk"
import type { ClineAsk, ToolProgressStatus } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import type { AutoApprovalContext, ToolResponse, ToolUse, McpToolUse } from "../../shared/tools"

import { buildAutoDenyReason } from "../auto-approval"
import { AskIgnoredError } from "../task/AskIgnoredError"
import type { Task } from "../task/Task"
import { useMcpToolTool } from "../tools/UseMcpToolTool"
import { validateToolUse } from "../tools/validateToolUse"
import { buildToolRequirements, type RequestPolicySnapshot } from "../prompts/tools/effective-tool-policy"
import { formatResponse } from "../prompts/responses"
import { sanitizeToolUseId } from "../../utils/tool-id"
import { isMcpToolAlias, MAX_MCP_TOOL_NAME_LENGTH, resolveMcpToolByName } from "../../utils/mcp-name"

// Native MCP calls share the use_mcp_tool handler and retain their original names in history.
export async function presentMcpToolUse(
	cline: Task,
	mcpBlock: McpToolUse,
	policySnapshot: RequestPolicySnapshot,
	isCurrent: () => boolean,
): Promise<void> {
	if (cline.didRejectTool) {
		// For native protocol, we must send a tool_result for every tool_use to avoid API errors
		const toolCallId = mcpBlock.id
		const errorMessage = !mcpBlock.partial
			? `Skipping MCP tool ${mcpBlock.name} due to user rejecting a previous tool.`
			: `MCP tool ${mcpBlock.name} was interrupted and not executed due to user rejecting a previous tool.`

		if (toolCallId) {
			cline.pushToolResultToUserContent({
				type: "tool_result",
				tool_use_id: sanitizeToolUseId(toolCallId),
				content: errorMessage,
				is_error: true,
			})
		}
		return
	}

	// Track if we've already pushed a tool result
	let hasToolResult = false
	const toolCallId = mcpBlock.id
	if (toolCallId && !cline.activeToolContexts.has(toolCallId)) {
		cline.activeToolContexts.set(toolCallId, { toolCallId, didReject: false })
	}

	// Store approval feedback to merge into tool result (GitHub #10465)
	let approvalFeedback: { text: string; images?: string[] } | undefined

	const pushToolResult = (content: ToolResponse, _feedbackImages?: string[]) => {
		if (!isCurrent()) return
		if (hasToolResult) {
			console.warn(`[presentAssistantMessage] Skipping duplicate tool_result for mcp_tool_use: ${toolCallId}`)
			return
		}

		let resultContent: string
		let imageBlocks: Anthropic.ImageBlockParam[] = []

		if (typeof content === "string") {
			resultContent = content || "(tool did not return anything)"
		} else {
			const textBlocks = content.filter((item) => item.type === "text")
			imageBlocks = content.filter((item) => item.type === "image") as Anthropic.ImageBlockParam[]
			resultContent =
				textBlocks.map((item) => (item as Anthropic.TextBlockParam).text).join("\n") ||
				"(tool did not return anything)"
		}

		// Merge approval feedback into tool result (GitHub #10465)
		if (approvalFeedback) {
			const feedbackText = formatResponse.toolApprovedWithFeedback(approvalFeedback.text)
			resultContent = `${feedbackText}\n\n${resultContent}`

			// Add feedback images to the image blocks
			if (approvalFeedback.images) {
				const feedbackImageBlocks = formatResponse.imageBlocks(approvalFeedback.images)
				imageBlocks = [...feedbackImageBlocks, ...imageBlocks]
			}
		}

		if (toolCallId) {
			cline.pushToolResultToUserContent({
				type: "tool_result",
				tool_use_id: sanitizeToolUseId(toolCallId),
				content: resultContent,
			})

			if (imageBlocks.length > 0) {
				cline.userMessageContent.push(...imageBlocks)
			}
		}

		hasToolResult = true
	}

	const askApproval = async (
		type: ClineAsk,
		partialMessage?: string,
		progressStatus?: ToolProgressStatus,
		isProtected?: boolean,
		autoApprovalContext?: AutoApprovalContext,
	) => {
		if (!isCurrent()) return false
		const { response, text, images, autoDenyDetail } = await cline.ask(
			type,
			partialMessage,
			false,
			progressStatus,
			isProtected || false,
			autoApprovalContext,
		)
		if (!isCurrent()) return false

		if (response !== "yesButtonClicked") {
			// Automatic (policy) denial: scoped to this tool call, so no
			// `didRejectTool` (remaining tool calls in the turn proceed)
			// and no `user_feedback` say (the reason is system-generated).
			if (autoDenyDetail) {
				// `guard_unavailable` marks a guard-state inconsistency, not a
				// policy denial: the command never ran and a re-issue re-reads
				// the guard setting, so the payload must stay a retryable error
				// instead of carrying policy-denial advice.
				if (autoDenyDetail.kind === "guard_unavailable") {
					pushToolResult(formatResponse.toolError(buildAutoDenyReason(autoDenyDetail)))
				} else {
					pushToolResult(
						formatResponse.toolAutoDenied({
							reason: buildAutoDenyReason(autoDenyDetail),
							offendingCommand: autoDenyDetail.command,
							ruleId: autoDenyDetail.dcgRuleId,
						}),
					)
				}
				return false
			}

			if (text) {
				await cline.say("user_feedback", text, images)
				if (!isCurrent()) return false
				pushToolResult(formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(text), images))
			} else {
				pushToolResult(formatResponse.toolDenied())
			}
			markToolRejected(cline, toolCallId ?? "")
			return false
		}

		// Store approval feedback to be merged into tool result (GitHub #10465)
		// Don't push it as a separate tool_result here - that would create duplicates.
		// The tool will call pushToolResult, which will merge the feedback into the actual result.
		if (text) {
			await cline.say("user_feedback", text, images)
			approvalFeedback = { text, images }
		}

		return isCurrent()
	}

	const handleError = async (action: string, error: Error) => {
		// Silently ignore AskIgnoredError - this is an internal control flow
		// signal, not an actual error. It occurs when a newer ask supersedes an older one.
		if (!isCurrent() || error instanceof AskIgnoredError) {
			return
		}
		const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`
		await cline.say("error", `Error ${action}:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`)
		pushToolResult(formatResponse.toolError(errorString))
	}

	const mcpHub = cline.providerRef.deref()?.getMcpHub()
	const needsResolution = isMcpToolAlias(mcpBlock.name) || mcpBlock.name.length > MAX_MCP_TOOL_NAME_LENGTH
	const resolved = needsResolution ? resolveMcpToolByName(mcpHub?.getServers() ?? [], mcpBlock.name) : undefined
	if (needsResolution && !resolved && !mcpBlock.partial) {
		const message =
			"The MCP tool name does not match a unique available tool. Use a name from the current tool list."
		cline.consecutiveMistakeCount++
		cline.recordToolError("use_mcp_tool", message)
		if (toolCallId) {
			cline.pushToolResultToUserContent({
				type: "tool_result",
				tool_use_id: sanitizeToolUseId(toolCallId),
				content: formatResponse.toolError(message),
				is_error: true,
			})
		}
		return
	}
	const resolvedServerName =
		resolved?.serverName ?? mcpHub?.findServerNameBySanitizedName(mcpBlock.serverName) ?? mcpBlock.serverName
	const resolvedToolName = resolved?.toolName ?? mcpBlock.toolName

	// Execute the MCP tool using the same handler as use_mcp_tool
	// Create a synthetic ToolUse block that the useMcpToolTool can handle
	const syntheticToolUse: ToolUse<"use_mcp_tool"> = {
		type: "tool_use",
		id: mcpBlock.id,
		name: "use_mcp_tool",
		params: {
			server_name: resolvedServerName,
			tool_name: resolvedToolName,
			arguments: JSON.stringify(mcpBlock.arguments),
		},
		partial: mcpBlock.partial,
		nativeArgs: {
			server_name: resolvedServerName,
			tool_name: resolvedToolName,
			arguments: mcpBlock.arguments,
		},
	}

	// Consult the shared policy layer before executing — ONLY for complete
	// (non-partial) blocks. Validating partial blocks would surface validation
	// errors repeatedly during streaming, pushing multiple tool_results for the
	// same tool_use_id and making the stream appear frozen.
	if (!mcpBlock.partial) {
		// Policy inputs come from the request's frozen snapshot, never from a
		// live provider-state re-read mid-stream.
		const { customModes, experiments: stateExperiments, disabledTools } = policySnapshot
		// Resolve aliases in includedTools before validation
		// e.g., "write_file" should resolve to "write_to_file"
		const rawIncludedTools = policySnapshot.modelInfo?.includedTools
		const { resolveToolAlias } = await import("../prompts/tools/filter-tools-for-mode")
		if (!isCurrent()) return
		const includedTools = rawIncludedTools?.map((tool) => resolveToolAlias(tool))

		try {
			const taskMode = await cline.getTaskMode()
			if (!isCurrent()) return
			// Validate under the canonical "use_mcp_tool" name: the requirements map
			// is keyed by canonical/alias names, so the dynamic mcp_* name would never
			// key-match a disabledTools or excludedTools entry naming use_mcp_tool.
			// Build requirements through the shared policy module so every suppressed
			// entry reaches the validator, which checks them before the
			// always-available class. See `buildToolRequirements` in
			// effective-tool-policy.ts.
			const toolRequirements = buildToolRequirements(disabledTools, policySnapshot.modelInfo)

			validateToolUse(
				"use_mcp_tool",
				taskMode,
				customModes ?? [],
				toolRequirements,
				syntheticToolUse.params,
				stateExperiments,
				includedTools,
			)
		} catch (error) {
			if (!isCurrent()) return
			const message = error instanceof Error ? error.message : String(error)
			cline.consecutiveMistakeCount++
			// For validation errors, send a tool_result with the error (required for
			// native tool calling) but do NOT set didAlreadyUseTool = true — the tool
			// was never executed, and interrupting the stream here would make the
			// extension appear to hang.
			const errorContent = formatResponse.toolError(message)
			if (toolCallId) {
				cline.pushToolResultToUserContent({
					type: "tool_result",
					tool_use_id: sanitizeToolUseId(toolCallId),
					content: errorContent,
					is_error: true,
				})
			}

			// The validator's message names the canonical tool, never the
			// model-controlled dynamic name, so this key is safe.
			cline.recordToolError("use_mcp_tool", message)

			return
		}
	}

	await useMcpToolTool.handle(cline, syntheticToolUse, {
		askApproval,
		handleError,
		pushToolResult,
		toolCallId: toolCallId ?? "",
		onValidated: mcpBlock.partial
			? undefined
			: () => {
					if (!isCurrent()) return
					cline.recordToolUsage("use_mcp_tool")
					TelemetryService.instance.captureToolUsage(cline.taskId, "use_mcp_tool")
				},
	})
}
