// Display the system prompt returned by the extension host.
// Extracted from ModesView.tsx.

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"

type SystemPromptPreviewProps = {
	selectedPromptTitle: string
	selectedPromptContent: string
	modeName?: string
	onClose: () => void
}

export function SystemPromptPreview({
	selectedPromptTitle,
	selectedPromptContent,
	modeName,
	onClose,
}: SystemPromptPreviewProps) {
	const { t } = useAppTranslation()
	return (
		<div className="fixed inset-0 flex justify-end bg-black/50 z-[1000]">
			<div className="w-[calc(100vw-100px)] h-full bg-vscode-editor-background shadow-md flex flex-col relative">
				<div className="flex-1 p-5 overflow-y-auto min-h-0">
					<Button variant="ghost" size="icon" onClick={onClose} className="absolute top-5 right-5">
						<span className="codicon codicon-close"></span>
					</Button>
					<h2 className="mb-4">
						{selectedPromptTitle ||
							t("prompts:systemPrompt.title", {
								modeName: modeName || "Code",
							})}
					</h2>
					<pre className="p-2 whitespace-pre-wrap break-words font-mono text-vscode-editor-font-size text-vscode-editor-foreground bg-vscode-editor-background border border-vscode-editor-lineHighlightBorder rounded overflow-y-auto">
						{selectedPromptContent}
					</pre>
				</div>
				<div className="flex justify-end p-3 px-5 border-t border-vscode-editor-lineHighlightBorder bg-vscode-editor-background">
					<Button variant="secondary" onClick={onClose}>
						{t("prompts:createModeDialog.close")}
					</Button>
				</div>
			</div>
		</div>
	)
}
