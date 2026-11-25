// Render the import scope selector and submit the import request.
// Extracted from ModesView.tsx.

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"

type ImportLevel = "global" | "project"

type ModeImportDialogProps = {
	importLevel: ImportLevel
	setImportLevel: (level: ImportLevel) => void
	isImporting: boolean
	setIsImporting: (importing: boolean) => void
	onClose: () => void
}

export function ModeImportDialog({
	importLevel,
	setImportLevel,
	isImporting,
	setIsImporting,
	onClose,
}: ModeImportDialogProps) {
	const { t } = useAppTranslation()
	return (
		<div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[1000]">
			<div className="bg-vscode-editor-background border border-vscode-editor-lineHighlightBorder rounded-lg shadow-lg p-6 max-w-md w-full">
				<h3 className="text-lg font-semibold mb-4">{t("prompts:modes.importMode")}</h3>
				<p className="text-sm text-vscode-descriptionForeground mb-4">{t("prompts:importMode.selectLevel")}</p>
				<div className="space-y-3 mb-6">
					<label className="flex items-start gap-2 cursor-pointer">
						<input
							type="radio"
							name="importLevel"
							value="project"
							className="mt-1"
							checked={importLevel === "project"}
							onChange={() => setImportLevel("project")}
						/>
						<div>
							<div className="font-medium">{t("prompts:importMode.project.label")}</div>
							<div className="text-xs text-vscode-descriptionForeground">
								{t("prompts:importMode.project.description")}
							</div>
						</div>
					</label>
					<label className="flex items-start gap-2 cursor-pointer">
						<input
							type="radio"
							name="importLevel"
							value="global"
							className="mt-1"
							checked={importLevel === "global"}
							onChange={() => setImportLevel("global")}
						/>
						<div>
							<div className="font-medium">{t("prompts:importMode.global.label")}</div>
							<div className="text-xs text-vscode-descriptionForeground">
								{t("prompts:importMode.global.description")}
							</div>
						</div>
					</label>
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={onClose}>
						{t("prompts:createModeDialog.buttons.cancel")}
					</Button>
					<Button
						variant="primary"
						onClick={() => {
							if (!isImporting) {
								setIsImporting(true)
								vscode.postMessage({
									type: "importMode",
									source: importLevel,
								})
							}
						}}
						disabled={isImporting}>
						{isImporting ? t("prompts:importMode.importing") : t("prompts:importMode.import")}
					</Button>
				</div>
			</div>
		</div>
	)
}
