import { useId, useState } from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import type { NativeAgentHandoff } from "@roo-code/types"

import { Button } from "@src/components/ui"
import { engineName } from "./AgentEngineSelector"

export function AgentHandoff({
	handoff,
	pending,
	onContinue,
	onCancel,
}: {
	handoff: NativeAgentHandoff
	pending: boolean
	onContinue: (text: string) => void
	onCancel: () => void
}) {
	const { t } = useAppTranslation()
	const id = useId()
	const [text, setText] = useState(handoff.text)
	return (
		<div className="mx-3 mb-2 flex min-h-0 flex-col gap-2 rounded border border-vscode-panel-border p-2">
			<label htmlFor={id} className="font-medium">
				{t("chat:agentEngine.reviewHandoff", { engine: engineName(handoff.engine) })}
			</label>
			<div className="break-words text-xs text-vscode-descriptionForeground">
				{handoff.model} · {handoff.connection}
				{" · "}
				{t(
					handoff.route === "subscription"
						? "chat:agentEngine.subscription"
						: handoff.route === "api-key"
							? "chat:agentEngine.apiBilling"
							: "chat:agentEngine.providerBilling",
				)}
				<div>{handoff.cwd}</div>
			</div>
			<textarea
				id={id}
				value={text}
				onChange={(event) => setText(event.target.value)}
				className="h-32 min-h-16 w-full resize-y rounded bg-vscode-input-background p-2 text-vscode-input-foreground"
			/>
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="primary" disabled={pending || !text.trim()} onClick={() => onContinue(text)}>
					{t("chat:agentEngine.startLinkedTask")}
				</Button>
				<Button size="sm" variant="secondary" disabled={pending} onClick={onCancel}>
					{t("chat:agentEngine.cancel")}
				</Button>
			</div>
		</div>
	)
}
