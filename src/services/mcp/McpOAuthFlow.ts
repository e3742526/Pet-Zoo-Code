// Coordinate the OAuth browser flow, token watcher, and progress cancellation.
// Extracted from McpHub.ts.

import * as vscode from "vscode"
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import { t } from "../../i18n"
import { OAUTH_FLOW_TIMEOUT_MS, TOKEN_EXPIRY_BUFFER_MS } from "./constants"
import type { ServerConfig } from "./mcpConfigSchema"
import type { ConnectedMcpConnection, McpConnection } from "./mcpConnection"
import type { McpOAuthClientProvider } from "./McpOAuthClientProvider"
import type { SecretStorageService } from "./SecretStorageService"

type ConnectionSource = "global" | "project"

type McpOAuthOperations = {
	getSecretStorage: () => SecretStorageService | undefined
	isDisposed: () => boolean
	findConnection: (name: string, source: ConnectionSource) => McpConnection | undefined
	deleteConnection: (name: string, source: ConnectionSource) => Promise<void>
	connectToServer: (name: string, config: ServerConfig, source: ConnectionSource) => Promise<void>
	validateServerConfig: (config: unknown, name: string) => ServerConfig
	appendErrorMessage: (connection: McpConnection, error: string) => void
	notifyWebviewOfServerChanges: () => Promise<void>
	complete: (
		authProvider: McpOAuthClientProvider,
		transport: StreamableHTTPClientTransport,
		connection: ConnectedMcpConnection,
		name: string,
		source: ConnectionSource,
		cancellationToken: vscode.CancellationToken,
	) => Promise<void>
}

export class McpOAuthFlow {
	readonly watchers = new Map<string, { unsubscribe: () => void; abortHandle: NodeJS.Timeout }>()

	constructor(private readonly operations: McpOAuthOperations) {}

	private get secretStorage(): SecretStorageService | undefined {
		return this.operations.getSecretStorage()
	}

	/**
	 * Background task: waits for the user to complete the OAuth browser flow,
	 * exchanges the auth code for tokens, then reconnects from scratch.
	 *
	 * After the SDK throws UnauthorizedError the transport is left in a
	 * "started" state (_abortController is set), so we cannot simply call
	 * client.connect() on it again — the SDK would throw "already started".
	 * The clean solution is to delete the broken connection and let
	 * connectToServer() create fresh client/transport objects. The new
	 * provider will find the token in SecretStorage and connect without
	 * triggering another OAuth round-trip.
	 *
	 * This runs detached from the initialization path so `waitUntilReady()`
	 * and the rest of the extension are not blocked by the user's browser session.
	 */
	async initiate(
		name: string,
		source: ConnectionSource,
		config: ServerConfig,
		authProvider: McpOAuthClientProvider,
		transport: StreamableHTTPClientTransport,
		connection: ConnectedMcpConnection,
	): Promise<void> {
		const serverUrl = "url" in config ? config.url : undefined
		const oauthClientId = config.type === "streamable-http" ? config.oauth?.clientId : undefined
		if (!serverUrl || !this.secretStorage) {
			return
		}

		// Register the cross-window token watcher BEFORE the initial token read so we
		// don't miss a write that lands in the gap between the read and the subscription.
		// After the read we immediately unsubscribe; the watcher inside run
		// will set up its own long-lived subscription for the duration of the flow.
		// Note: onDidChange fires on both writes AND deletes — the re-read below is
		// authoritative; we only reconnect if it returns a valid (non-expired) token.
		let tokenChangedDuringRead = false
		const unsubscribeCrossWindow = this.secretStorage.onDidChange(
			serverUrl,
			() => {
				tokenChangedDuringRead = true
			},
			oauthClientId,
		)

		// Check if another window already saved valid tokens.
		// Re-read after registering the watcher in case a write landed in the gap.
		const existing = await this.secretStorage.getOAuthData(serverUrl, oauthClientId)
		if (this.operations.isDisposed()) {
			unsubscribeCrossWindow()
			await authProvider.close()
			return
		}
		// If the first read missed but the watcher fired during it, re-read — a write
		// may have landed between subscription and read completion.
		const tokenToUse =
			existing ??
			(tokenChangedDuringRead ? await this.secretStorage.getOAuthData(serverUrl, oauthClientId) : undefined)
		unsubscribeCrossWindow()

		if (
			!this.operations.isDisposed() &&
			tokenToUse &&
			Date.now() < tokenToUse.expires_at - TOKEN_EXPIRY_BUFFER_MS
		) {
			await authProvider.close()
			await this.operations.deleteConnection(name, source)
			await this.operations.connectToServer(name, config, source)
			await this.operations.notifyWebviewOfServerChanges()
			return
		}

		// Persistent progress notification gives the user a visible Cancel button
		// for the duration of the flow (even if they switch away from VS Code).
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: t("mcp:oauth.flow.authenticating", { name }),
				cancellable: true,
			},
			(progress, cancellationToken) =>
				this.run(
					name,
					source,
					config,
					serverUrl,
					authProvider,
					transport,
					connection,
					progress,
					cancellationToken,
					oauthClientId,
				),
		)
	}

	private run(
		name: string,
		source: ConnectionSource,
		config: ServerConfig,
		serverUrl: string,
		authProvider: McpOAuthClientProvider,
		transport: StreamableHTTPClientTransport,
		connection: ConnectedMcpConnection,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		cancellationToken: vscode.CancellationToken,
		oauthClientId?: string,
	): Promise<void> {
		const watcherKey = `${name}:${source}`

		// Cancel any existing watcher for this connection before starting a new one
		const existing = this.watchers.get(watcherKey)
		if (existing) {
			existing.unsubscribe()
			clearTimeout(existing.abortHandle)
			this.watchers.delete(watcherKey)
		}

		return new Promise<void>((resolve) => {
			let disposed = false

			const cleanup = (disposable?: vscode.Disposable) => {
				if (disposed) return
				disposed = true
				clearTimeout(timeoutHandle)
				unsubscribe()
				disposable?.dispose()
				this.watchers.delete(watcherKey)
			}

			// --- Cross-window token watcher ---
			const onTokensChanged = async () => {
				if (disposed || this.operations.isDisposed()) return
				// Don't reconnect if the server is already connected (e.g. a token refresh
				// from another window fired after complete already succeeded).
				const conn = this.operations.findConnection(name, source)
				if (!conn || conn.server.status === "connected") {
					cleanup(cancellationDisposable)
					return
				}
				try {
					const data = await this.secretStorage?.getOAuthData(serverUrl, oauthClientId)
					// Re-check after the async yield — cancellation or completion may have
					// fired while getOAuthData was in flight.
					if (disposed || this.operations.isDisposed()) return
					if (data && Date.now() < data.expires_at - TOKEN_EXPIRY_BUFFER_MS) {
						cleanup(cancellationDisposable)
						await authProvider.close()
						await this.operations.deleteConnection(name, source)
						const validatedConfig = this.operations.validateServerConfig(config, name)
						await this.operations.connectToServer(name, validatedConfig, source)
						await this.operations.notifyWebviewOfServerChanges()
						resolve()
					}
				} catch (err) {
					console.error(`[McpHub] OAuth token watcher failed for "${name}":`, err)
				}
			}

			const unsubscribe = this.secretStorage!.onDidChange(
				serverUrl,
				() => {
					void onTokensChanged()
				},
				oauthClientId,
			)

			// --- Timeout ---
			const timeoutHandle = setTimeout(() => {
				if (disposed) return
				cleanup(cancellationDisposable)
				void authProvider.close()
				const conn = this.operations.findConnection(name, source)
				if (conn && conn.server.status === "connecting") {
					conn.server.status = "disconnected"
					this.operations.appendErrorMessage(conn, t("mcp:oauth.flow.timedOut"))
					void this.operations.notifyWebviewOfServerChanges()
				}
				resolve()
			}, OAUTH_FLOW_TIMEOUT_MS)

			// Register the watcher so the hub can clean it up on disconnect or disposal.
			// This must happen BEFORE installing the cancellation callback below: if the
			// token is already cancelled at registration time, VS Code fires the callback
			// synchronously inside onCancellationRequested(...), and cleanup() must find
			// the watcher entry in the map in order to delete it. Registering after the
			// callback would leave an orphan entry that survives disposal.
			this.watchers.set(watcherKey, { unsubscribe, abortHandle: timeoutHandle })

			// --- Cancellation (progress bar's Cancel button) ---
			const cancellationDisposable = cancellationToken.onCancellationRequested(() => {
				if (disposed) return
				// Don't pass cancellationDisposable here: if the token was already
				// cancelled at registration time, VS Code fires this callback
				// synchronously inside onCancellationRequested(...) — before the
				// `const cancellationDisposable = ...` assignment completes, so the
				// binding is still in the TDZ. VS Code also disposes its own
				// listener once the token transitions to cancelled, so explicit
				// disposal from inside the callback would be redundant anyway.
				cleanup()
				void authProvider.close()
				const conn = this.operations.findConnection(name, source)
				if (conn && conn.server.status !== "connected") {
					conn.server.status = "disconnected"
					this.operations.appendErrorMessage(conn, t("mcp:oauth.flow.cancelled"))
					void this.operations.notifyWebviewOfServerChanges()
				}
				resolve()
			})

			// In test mode, skip user interaction and proceed directly to complete the OAuth flow.
			if (process.env.MCP_OAUTH_TEST_MODE === "true") {
				void (async () => {
					cleanup(cancellationDisposable)
					try {
						await this.operations.complete(
							authProvider,
							transport,
							connection,
							name,
							source,
							cancellationToken,
						)
					} catch {
						// complete handles its own error state
					}
					resolve()
				})()
				return
			}

			// Non-modal toast — fires once. If dismissed without clicking Authenticate,
			// the flow stays alive via the persistent progress bar (Cancel to abort).
			const authenticateLabel = t("mcp:oauth.flow.authenticateButton")
			void (async () => {
				const choice = await vscode.window.showInformationMessage(
					t("mcp:oauth.flow.clickAuthenticate", { name }),
					authenticateLabel,
				)

				if (disposed) return

				if (choice !== authenticateLabel) {
					progress.report({ message: t("mcp:oauth.flow.dismissedHint") })
					return
				}

				// Guard: another window may have authed while the toast was open
				const tokens = await this.secretStorage!.getOAuthData(serverUrl, oauthClientId)
				if (disposed) return
				if (tokens && Date.now() < tokens.expires_at - TOKEN_EXPIRY_BUFFER_MS) {
					cleanup(cancellationDisposable)
					await authProvider.close()
					await this.operations.deleteConnection(name, source)
					const validatedFastPathConfig = this.operations.validateServerConfig(config, name)
					await this.operations.connectToServer(name, validatedFastPathConfig, source)
					await this.operations.notifyWebviewOfServerChanges()
					resolve()
					return
				}

				// Clean up before exchanging tokens — this sets disposed=true so the
				// cross-window token watcher doesn't race to reconnect when SecretStorage
				// fires onDidChange during token exchange inside complete.
				cleanup(cancellationDisposable)
				try {
					await this.operations.complete(authProvider, transport, connection, name, source, cancellationToken)
				} catch {
					// complete handles its own error state
				}
				resolve()
			})()
		})
	}

	async complete(
		authProvider: McpOAuthClientProvider,
		_transport: StreamableHTTPClientTransport,
		connection: ConnectedMcpConnection,
		name: string,
		source: ConnectionSource,
		cancellationToken: vscode.CancellationToken,
	): Promise<void> {
		const config = JSON.parse(connection.server.config)

		// Build a promise that rejects when the progress bar Cancel is pressed,
		// so we can race it against waitForAuthCode() which blocks indefinitely.
		const cancelledError = new Error(t("mcp:oauth.flow.cancelled"))
		let cancelListener: vscode.Disposable | undefined
		const cancellationPromise = new Promise<never>((_, reject) => {
			if (cancellationToken.isCancellationRequested) {
				reject(cancelledError)
				return
			}
			cancelListener = cancellationToken.onCancellationRequested(() => reject(cancelledError))
		})

		try {
			// Open the browser now that the user has confirmed the toast.
			// redirectToAuthorization() was already called by the SDK (which stored
			// the URL in _pendingAuthorizationUrl), but deliberately did not open it.
			await authProvider.openBrowser()

			const code = await Promise.race([authProvider.waitForAuthCode(), cancellationPromise])

			// Exchange auth code for tokens using the pre-fetched token_endpoint
			// directly. The SDK's transport.finishAuth() re-runs discovery internally
			// and hits the same broken URL for path-prefixed issuers (see
			// utils/oauth.ts for upstream issue links).
			await authProvider.exchangeCodeForTokens(code)
			await authProvider.close()

			// Recover the validated server config stored on the connection so we
			// can pass it directly to connectToServer without re-reading the file.
			const validatedConfig = this.operations.validateServerConfig(config, name)

			// Remove the broken connection (closes the old transport/client),
			// then reconnect. The new McpOAuthClientProvider will find the token
			// in SecretStorage and connect without another OAuth round-trip.
			await this.operations.deleteConnection(name, source)
			await this.operations.connectToServer(name, validatedConfig, source)

			await this.operations.notifyWebviewOfServerChanges()
			void vscode.window.showInformationMessage(t("mcp:oauth.flow.connected", { name }))
		} catch (error) {
			await authProvider.close()
			const conn = this.operations.findConnection(name, source)
			if (conn) {
				conn.server.status = "disconnected"
				this.operations.appendErrorMessage(conn, error instanceof Error ? error.message : `${error}`)
			}
			await this.operations.notifyWebviewOfServerChanges()
		} finally {
			cancelListener?.dispose()
		}
	}
}
