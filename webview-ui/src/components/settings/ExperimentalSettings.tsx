import { HTMLAttributes } from "react"

import type { Experiments, ImageGenerationProvider, ProviderSettings } from "@roo-code/types"

import { EXPERIMENT_IDS } from "@roo/experiments"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

import { SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { getExperimentSettingId, visibleSettingsExperiments } from "./settingsSearchIndex"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { ImageGenerationSettings } from "./ImageGenerationSettings"
import { CustomToolsSettings } from "./CustomToolsSettings"

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	experiments: Experiments
	setExperimentEnabled: SetExperimentEnabled
	apiConfiguration: ProviderSettings
	setApiConfigurationField?: any
	imageGenerationProvider?: ImageGenerationProvider
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	setImageGenerationProvider?: (provider: ImageGenerationProvider) => void
	setOpenRouterImageApiKey?: (apiKey: string) => void
	setImageGenerationSelectedModel?: (model: string) => void
}

export const ExperimentalSettings = ({
	experiments,
	setExperimentEnabled,
	apiConfiguration,
	setApiConfigurationField,
	imageGenerationProvider,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
	setImageGenerationProvider,
	setOpenRouterImageApiKey,
	setImageGenerationSelectedModel,
	className,
	...props
}: ExperimentalSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.experimental")}</SectionHeader>

			<Section>
				{visibleSettingsExperiments.map((experimentKey) => {
					if (
						experimentKey === "IMAGE_GENERATION" &&
						setImageGenerationProvider &&
						setOpenRouterImageApiKey &&
						setImageGenerationSelectedModel
					) {
						return (
							<SearchableSetting key={experimentKey} settingId={getExperimentSettingId(experimentKey)}>
								<ImageGenerationSettings
									enabled={experiments[EXPERIMENT_IDS.IMAGE_GENERATION] ?? false}
									onChange={(enabled) =>
										setExperimentEnabled(EXPERIMENT_IDS.IMAGE_GENERATION, enabled)
									}
									imageGenerationProvider={imageGenerationProvider}
									openRouterImageApiKey={openRouterImageApiKey}
									openRouterImageGenerationSelectedModel={openRouterImageGenerationSelectedModel}
									setImageGenerationProvider={setImageGenerationProvider}
									setOpenRouterImageApiKey={setOpenRouterImageApiKey}
									setImageGenerationSelectedModel={setImageGenerationSelectedModel}
								/>
							</SearchableSetting>
						)
					}
					if (experimentKey === "CUSTOM_TOOLS") {
						return (
							<SearchableSetting key={experimentKey} settingId={getExperimentSettingId(experimentKey)}>
								<CustomToolsSettings
									enabled={experiments[EXPERIMENT_IDS.CUSTOM_TOOLS] ?? false}
									onChange={(enabled) => setExperimentEnabled(EXPERIMENT_IDS.CUSTOM_TOOLS, enabled)}
								/>
							</SearchableSetting>
						)
					}
					return (
						<SearchableSetting key={experimentKey} settingId={getExperimentSettingId(experimentKey)}>
							<ExperimentalFeature
								experimentKey={experimentKey}
								enabled={experiments[EXPERIMENT_IDS[experimentKey]] ?? false}
								onChange={(enabled) => setExperimentEnabled(EXPERIMENT_IDS[experimentKey], enabled)}
							/>
						</SearchableSetting>
					)
				})}
			</Section>
		</div>
	)
}
