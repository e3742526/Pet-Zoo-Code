// Connection state types and disable reasons, re-exported by McpHub.ts.
// Extracted from McpHub.ts.

import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { McpServer } from "@roo-code/types"

import type { McpOAuthClientProvider } from "./McpOAuthClientProvider"

// Discriminated union for connection states
export type ConnectedMcpConnection = {
	type: "connected"
	server: McpServer
	client: Client
	transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport
	authProvider?: McpOAuthClientProvider
}

export type DisconnectedMcpConnection = {
	type: "disconnected"
	server: McpServer
	client: null
	transport: null
}

export type McpConnection = ConnectedMcpConnection | DisconnectedMcpConnection

// Enum for disable reasons
export enum DisableReason {
	MCP_DISABLED = "mcpDisabled",
	SERVER_DISABLED = "serverDisabled",
}
