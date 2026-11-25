// Read a connected server's advertised tools and resources with its stored tool preferences.
// Extracted from McpHub.ts.

import * as fs from "fs/promises"

import {
	ListResourcesResultSchema,
	ListResourceTemplatesResultSchema,
	ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { McpResource, McpResourceTemplate, McpTool } from "@roo-code/types"

import type { McpConnection } from "./mcpConnection"

export class McpCapabilities {
	constructor(
		private readonly findConnection: (name: string, source?: "global" | "project") => McpConnection | undefined,
		private readonly getProjectMcpPath: () => Promise<string | null>,
		private readonly getMcpSettingsFilePath: () => Promise<string>,
	) {}

	async fetchToolsList(serverName: string, source?: "global" | "project"): Promise<McpTool[]> {
		try {
			// Use the helper method to find the connection
			const connection = this.findConnection(serverName, source)

			if (!connection || connection.type !== "connected") {
				return []
			}

			const response = await connection.client.request({ method: "tools/list" }, ListToolsResultSchema)

			// Determine the actual source of the server
			const actualSource = connection.server.source || "global"
			let configPath: string
			let alwaysAllowConfig: string[] = []
			let disabledToolsList: string[] = []

			// Read from the appropriate config file based on the actual source
			try {
				let serverConfigData: {
					mcpServers?: Record<string, { alwaysAllow?: string[]; disabledTools?: string[] }>
				} = {}
				if (actualSource === "project") {
					// Get project MCP config path
					const projectMcpPath = await this.getProjectMcpPath()
					if (projectMcpPath) {
						configPath = projectMcpPath
						const content = await fs.readFile(configPath, "utf-8")
						serverConfigData = JSON.parse(content)
					}
				} else {
					// Get global MCP settings path
					configPath = await this.getMcpSettingsFilePath()
					const content = await fs.readFile(configPath, "utf-8")
					serverConfigData = JSON.parse(content)
				}
				if (serverConfigData) {
					alwaysAllowConfig = serverConfigData.mcpServers?.[serverName]?.alwaysAllow || []
					disabledToolsList = serverConfigData.mcpServers?.[serverName]?.disabledTools || []
				}
			} catch (error) {
				console.error(`Failed to read tool configuration for ${serverName}:`, error)
				// Continue with empty configs
			}

			// Check if wildcard "*" is in the alwaysAllow config
			const hasWildcard = alwaysAllowConfig.includes("*")

			// Mark tools as always allowed and enabled for prompt based on settings
			const tools = (response?.tools || []).map((tool) => ({
				...tool,
				alwaysAllow: hasWildcard || alwaysAllowConfig.includes(tool.name),
				enabledForPrompt: !disabledToolsList.includes(tool.name),
			}))

			return tools
		} catch (error) {
			console.error(`Failed to fetch tools for ${serverName}:`, error)
			return []
		}
	}

	async fetchResourcesList(serverName: string, source?: "global" | "project"): Promise<McpResource[]> {
		try {
			const connection = this.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}
			const response = await connection.client.request({ method: "resources/list" }, ListResourcesResultSchema)
			return response?.resources || []
		} catch {
			// console.error(`Failed to fetch resources for ${serverName}:`, error)
			return []
		}
	}

	async fetchResourceTemplatesList(
		serverName: string,
		source?: "global" | "project",
	): Promise<McpResourceTemplate[]> {
		try {
			const connection = this.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}
			const response = await connection.client.request(
				{ method: "resources/templates/list" },
				ListResourceTemplatesResultSchema,
			)
			return response?.resourceTemplates || []
		} catch {
			// console.error(`Failed to fetch resource templates for ${serverName}:`, error)
			return []
		}
	}
}
