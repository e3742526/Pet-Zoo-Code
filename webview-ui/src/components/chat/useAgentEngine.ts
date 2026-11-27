import { useCallback, useEffect, useRef, useState } from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	getAgentProfileModelId,
	providerIdentifiers,
	type AgentEngineId,
	type ExtensionMessage,
	type NativeAgentAvailability,
	type NativeAgentCommand,
	type NativeAgentHandoff,
} from "@roo-code/types"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

export function useAgentEngine(currentTaskId: string | undefined) {
	const { t } = useAppTranslation()
	const { apiConfiguration, currentApiConfigName, listApiConfigMeta, cwd, nativeAgentView } = useExtensionState()
	const provider = apiConfiguration.apiProvider
	const candidate: AgentEngineId | undefined =
		provider === providerIdentifiers.anthropic
			? "claude-agent"
			: provider === providerIdentifiers.openaiCodex || provider === providerIdentifiers.openaiNative
				? "codex"
				: undefined
	const profileId = listApiConfigMeta?.find(({ name }) => name === currentApiConfigName)?.id ?? ""
	const model = getAgentProfileModelId(apiConfiguration) ?? ""
	const key = JSON.stringify([profileId, model, apiConfiguration.nativeAgentAuth, cwd])
	const preferred = apiConfiguration.agentEngine ?? "dory"
	const engine: AgentEngineId = !currentTaskId && candidate && preferred === candidate ? preferred : "dory"
	const [result, setResult] = useState<{ key: string; availability?: NativeAgentAvailability }>()
	const [error, setError] = useState<string>()
	const [pending, setPending] = useState(false)
	const [handoff, setHandoff] = useState<NativeAgentHandoff>()
	const requests = useRef(new Map<string, (result: NonNullable<ExtensionMessage["nativeAgentResult"]>) => void>())

	const request = useCallback(
		(
			command: NativeAgentCommand,
			callback?: (result: NonNullable<ExtensionMessage["nativeAgentResult"]>) => void,
		) => {
			const requestId = crypto.randomUUID()
			if (callback) {
				const timer = setTimeout(() => {
					requests.current.delete(requestId)
					callback({ requestId, error: t("chat:agentEngine.requestTimedOut") })
				}, 60_000)
				requests.current.set(requestId, (result) => {
					clearTimeout(timer)
					callback(result)
				})
			}
			vscode.postMessage({ type: "nativeAgent", requestId, nativeAgentCommand: command })
		},
		[t],
	)

	useEffect(() => {
		const receive = (event: MessageEvent<ExtensionMessage>) => {
			if (event.data.type !== "nativeAgentResult" || !event.data.nativeAgentResult) return
			const result = event.data.nativeAgentResult
			const callback = requests.current.get(result.requestId)
			requests.current.delete(result.requestId)
			callback?.(result)
		}
		window.addEventListener("message", receive)
		return () => window.removeEventListener("message", receive)
	}, [])

	const discover = useCallback(() => {
		if (!candidate || !profileId || !model) return
		setResult(undefined)
		request({ kind: "discover", profileId, model }, ({ availability, error }) => {
			setResult({
				key,
				availability: availability ?? {
					profileId,
					model,
					engine: candidate,
					reason: error ?? t("chat:agentEngine.setupUnavailable"),
				},
			})
		})
	}, [candidate, profileId, model, request, key, t])

	useEffect(() => {
		setError(undefined)
		if (!currentTaskId) discover()
	}, [currentTaskId, discover])

	const availability =
		candidate && !currentTaskId && profileId && model
			? ((result?.key === key ? result.availability : undefined) ?? {
					profileId,
					model,
					engine: candidate,
					reason: t("chat:agentEngine.checkingSetup"),
				})
			: undefined
	const select = (choice: AgentEngineId) => {
		if (pending || !availability || choice === engine) return
		setPending(true)
		setError(undefined)
		request(
			{ kind: "prefer", profileId, model, engine: choice, selection: availability.selection },
			({ error }) => {
				setPending(false)
				setError(error)
			},
		)
	}

	const send = (text: string, images: string[], hasAttachments: boolean, onAccepted: () => void) => {
		if (pending || (!nativeAgentView && !availability?.selection)) {
			setError(availability?.reason ?? t("chat:agentEngine.checkBeforeSend"))
			return
		}
		setPending(true)
		setError(undefined)
		request(
			{
				kind: "send",
				taskId: nativeAgentView?.taskId,
				profileId,
				model,
				selection: availability?.selection,
				text,
				images,
				hasAttachments,
			},
			({ error }) => {
				setPending(false)
				setError(error)
				if (!error) onAccepted()
			},
		)
	}

	const action = (command: NativeAgentCommand) => request(command, ({ error }) => setError(error))
	const prepareContinuation = (target: AgentEngineId) => {
		if (pending || !currentTaskId || !profileId || !model) return
		setPending(true)
		setError(undefined)
		request({ kind: "prepare-continuation", taskId: currentTaskId, profileId, model, engine: target }, (result) => {
			setPending(false)
			setHandoff(result.handoff)
			setError(result.error)
		})
	}
	const continueTask = (text: string) => {
		if (pending || !handoff) return
		setPending(true)
		request({ kind: "continue", handoffId: handoff.id, text }, ({ error }) => {
			setPending(false)
			setError(error)
			if (!error) setHandoff(undefined)
		})
	}
	return {
		engine,
		availability,
		select,
		discover,
		send,
		action,
		pending,
		error,
		handoff,
		candidate,
		prepareContinuation,
		continueTask,
		cancelContinuation: () => {
			if (handoff) action({ kind: "cancel-continuation", handoffId: handoff.id })
			setHandoff(undefined)
		},
	}
}
