// Construct stdio and SSE transports with their platform and request options.
// Extracted from McpHub.ts.

import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import ReconnectingEventSource from "reconnecting-eventsource"

import type { ServerConfig } from "./mcpConfigSchema"

export function createStdioTransport(config: Extract<ServerConfig, { type: "stdio" }>): StdioClientTransport {
	// On Windows, wrap commands with cmd.exe to handle non-exe executables like npx.ps1
	// This is necessary for node version managers (fnm, nvm-windows, volta) that implement
	// commands as PowerShell scripts rather than executables.
	// Note: This adds a small overhead as commands go through an additional shell layer.
	const isWindows = process.platform === "win32"

	// Check if command is already cmd.exe to avoid double-wrapping
	const isAlreadyWrapped = config.command.toLowerCase() === "cmd.exe" || config.command.toLowerCase() === "cmd"

	const command = isWindows && !isAlreadyWrapped ? "cmd.exe" : config.command
	const args = isWindows && !isAlreadyWrapped ? ["/c", config.command, ...(config.args || [])] : config.args

	return new StdioClientTransport({
		command,
		args,
		cwd: config.cwd,
		env: {
			...getDefaultEnvironment(),
			...(config.env || {}),
		},
		stderr: "pipe",
	})
}

export function createSseTransport(config: Extract<ServerConfig, { type: "sse" }>): SSEClientTransport {
	// SSE connection
	const sseOptions = {
		requestInit: {
			headers: config.headers,
		},
	}
	// Configure ReconnectingEventSource options
	const reconnectingEventSourceOptions = {
		max_retry_time: 5000, // Maximum retry time in milliseconds
		withCredentials: config.headers?.["Authorization"] ? true : false, // Enable credentials if Authorization header exists
		fetch: (url: string | URL, init: RequestInit) => {
			const headers = new Headers({ ...(init?.headers || {}), ...(config.headers || {}) })
			return fetch(url, {
				...init,
				headers,
			})
		},
	}
	global.EventSource = ReconnectingEventSource
	return new SSEClientTransport(new URL(config.url), {
		...sseOptions,
		eventSourceInit: reconnectingEventSourceOptions,
	})
}
