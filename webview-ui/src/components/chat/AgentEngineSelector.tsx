import { useId } from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import type { AgentEngineId, NativeAgentAvailability } from "@roo-code/types"

export function engineName(engine: string): string {
	if (engine === "codex") return "Codex"
	if (engine === "claude-agent") return "Claude Agent"
	if (engine === "dory") return "Dory"
	return "Unsupported engine"
}

export function AgentEngineSelector({
	availability,
	engine,
	pending,
	onChange,
	onRefresh,
}: {
	availability: NativeAgentAvailability
	engine: AgentEngineId
	pending?: boolean
	onChange: (engine: AgentEngineId) => void
	onRefresh: () => void
}) {
	const { t } = useAppTranslation()
	const name = useId()
	const detail = useId()
	const native = availability.engine
	const label = engineName(native)
	return (
		<fieldset aria-describedby={detail} className="min-w-0 rounded border border-vscode-panel-border px-2 pb-1">
			<legend className="px-1 text-xs text-vscode-descriptionForeground">{t("chat:agentEngine.label")}</legend>
			<div className="flex flex-wrap items-center gap-1">
				{(["dory", native] as const).map((option) => (
					<label key={option} className="cursor-pointer">
						<input
							type="radio"
							name={name}
							className="peer sr-only"
							checked={engine === option}
							disabled={pending || (option !== "dory" && !availability.selection)}
							onChange={() => onChange(option)}
						/>
						<span className="inline-flex min-h-6 items-center rounded border border-vscode-panel-border px-2 text-xs peer-checked:border-vscode-focusBorder peer-checked:font-semibold peer-focus-visible:outline peer-focus-visible:outline-vscode-focusBorder peer-disabled:opacity-60">
							{engineName(option)}
						</span>
					</label>
				))}
				{(availability.reason || engine === native) && (
					<button
						type="button"
						className="px-1 text-xs text-vscode-textLink-foreground underline"
						onClick={onRefresh}>
						{t("chat:agentEngine.checkSetup")}
					</button>
				)}
			</div>
			<div id={detail} className="mt-1 break-words text-xs text-vscode-descriptionForeground">
				{availability.reason
					? `${label} · ${availability.reason}`
					: engine === "dory"
						? t("chat:agentEngine.description")
						: `${availability.model} · ${availability.connection} · ${t(availability.route === "subscription" ? "chat:agentEngine.subscription" : "chat:agentEngine.apiBilling")}`}
			</div>
		</fieldset>
	)
}
