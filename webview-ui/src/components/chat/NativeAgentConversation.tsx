import { useEffect, useRef, useState } from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import type { HistoryItem, NativeAgentCommand, NativeAgentView } from "@roo-code/types"

import { Button } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"
import { engineName } from "./AgentEngineSelector"

export function NativeAgentConversation({
	view,
	item,
	action,
}: {
	view: NativeAgentView
	item?: HistoryItem
	action: (command: NativeAgentCommand) => void
}) {
	const { t } = useAppTranslation()
	const end = useRef<HTMLDivElement>(null)
	const name = engineName(view.engine)
	useEffect(() => {
		end.current?.scrollIntoView?.({ block: "end" })
	}, [view.rows])
	return (
		<div className="min-h-0 grow overflow-y-auto p-3">
			<div className="mb-2 flex flex-wrap items-center gap-2">
				<strong>{name}</strong>
				<span role="status">{t(`chat:agentEngine.status.${view.status}`)}</span>
				{view.session && (
					<Button size="sm" variant="secondary" onClick={() => action({ kind: "diff", taskId: view.taskId })}>
						{t("chat:agentEngine.reviewChanges")}
					</Button>
				)}
				<Button size="sm" variant="secondary" onClick={() => vscode.postMessage({ type: "exportCurrentTask" })}>
					{t("chat:agentEngine.export")}
				</Button>
			</div>
			{view.session && (
				<details className="mb-2 break-words text-xs">
					<summary>
						{view.session.model} · {view.session.connection} ·{" "}
						{t(
							view.session.route === "subscription"
								? "chat:agentEngine.subscription"
								: "chat:agentEngine.apiBilling",
						)}
					</summary>
					<div>{view.session.cwd}</div>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => action({ kind: "export-recovery", taskId: view.taskId })}>
						{t("chat:agentEngine.exportRecovery")}
					</Button>
					<div>
						{view.engine === "codex"
							? t("chat:agentEngine.codexPermissions")
							: t("chat:agentEngine.claudePermissions")}
					</div>
					{view.usage && <div>{t("chat:agentEngine.tokens", view.usage)}</div>}
				</details>
			)}
			{item?.continuedFromTaskId && (
				<Button
					size="sm"
					variant="ghost"
					onClick={() => vscode.postMessage({ type: "showTaskWithId", text: item.continuedFromTaskId })}>
					{t("chat:agentEngine.openSource")}
				</Button>
			)}
			{item?.continuedToTaskIds?.map((id) => (
				<Button
					key={id}
					size="sm"
					variant="ghost"
					onClick={() => vscode.postMessage({ type: "showTaskWithId", text: id })}>
					{t("chat:agentEngine.openLinked")}
				</Button>
			))}

			{view.error && (
				<p role="alert" className="text-vscode-errorForeground">
					{view.error}
				</p>
			)}
			{view.rows.map((row) => (
				<div key={row.id} className="my-2 rounded border border-vscode-panel-border p-2">
					<strong className="text-xs">
						{row.kind === "user"
							? t("chat:agentEngine.rowYou")
							: row.kind === "action"
								? t("chat:agentEngine.rowAction", { engine: name })
								: name}
					</strong>
					<div className="whitespace-pre-wrap break-words">{row.text}</div>
				</div>
			))}
			{view.approval && (
				<div
					className="my-2 rounded border border-vscode-focusBorder p-2"
					role="group"
					aria-label={t("chat:agentEngine.approvalLabel", { engine: name })}>
					<strong>
						{name} · {view.approval.operation}
					</strong>
					<p className="whitespace-pre-wrap break-words">{view.approval.detail}</p>
					<div className="flex flex-wrap gap-2">
						{[true, false].map((allow) => (
							<Button
								key={String(allow)}
								variant={allow ? "primary" : "secondary"}
								onClick={() => {
									if (view.approval)
										action({
											kind: "approve",
											taskId: view.taskId,
											approvalId: view.approval.id,
											allow,
										})
								}}>
								{t(allow ? "chat:agentEngine.allowOnce" : "chat:agentEngine.deny")}
							</Button>
						))}
					</div>
				</div>
			)}
			{view.question && (
				<AgentQuestions key={view.question.id} question={view.question} taskId={view.taskId} action={action} />
			)}
			<div ref={end} />
		</div>
	)
}

function AgentQuestions({
	question,
	taskId,
	action,
}: {
	question: NonNullable<NativeAgentView["question"]>
	taskId: string
	action: (command: NativeAgentCommand) => void
}) {
	const { t } = useAppTranslation()
	const [answers, setAnswers] = useState<Record<string, string>>({})
	const send = (value?: Record<string, string>) =>
		action({ kind: "answer", taskId, questionId: question.id, answers: value })
	return (
		<div className="my-2 flex flex-col gap-2 rounded border border-vscode-focusBorder p-2">
			{question.questions.map((entry) => (
				<div key={entry.question}>
					<label className="block">
						{entry.question}
						<input
							value={answers[entry.question] ?? ""}
							maxLength={2000}
							onChange={(event) => setAnswers({ ...answers, [entry.question]: event.target.value })}
							className="block w-full rounded bg-vscode-input-background p-1"
						/>
					</label>
					<div className="flex flex-wrap gap-1">
						{entry.options.map((option) => (
							<Button
								key={option.label}
								title={option.description}
								variant="secondary"
								size="sm"
								onClick={() => {
									const current = answers[entry.question]
									setAnswers({
										...answers,
										[entry.question]:
											entry.multiSelect && current ? current + ", " + option.label : option.label,
									})
								}}>
								{option.label}
							</Button>
						))}
					</div>
				</div>
			))}
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={!question.questions.every((entry) => answers[entry.question]?.trim())}
					onClick={() => send(answers)}>
					{t("chat:agentEngine.sendAnswers")}
				</Button>
				<Button variant="secondary" onClick={() => send()}>
					{t("chat:agentEngine.skipQuestions")}
				</Button>
			</div>
		</div>
	)
}
