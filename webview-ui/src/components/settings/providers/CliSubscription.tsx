import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { ANTIGRAVITY_DEFAULT_EXECUTABLE, MUSE_CODE_DEFAULT_EXECUTABLE, type ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"

import { inputEventTransform } from "../transforms"

type CliSubscriptionKind = "museCode" | "antigravity"

const CLI_SUBSCRIPTION_CONFIG = {
	museCode: {
		field: "museCodeExecutablePath",
		defaultExecutable: MUSE_CODE_DEFAULT_EXECUTABLE,
		loginCommand: "muse login",
	},
	antigravity: {
		field: "antigravityExecutablePath",
		defaultExecutable: ANTIGRAVITY_DEFAULT_EXECUTABLE,
		loginCommand: "agy",
	},
} as const satisfies Record<
	CliSubscriptionKind,
	{ field: keyof ProviderSettings; defaultExecutable: string; loginCommand: string }
>

type CliSubscriptionProps = {
	kind: CliSubscriptionKind
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

/** Settings for providers that run a locally installed, subscription-authenticated CLI. */
export const CliSubscription = ({ kind, apiConfiguration, setApiConfigurationField }: CliSubscriptionProps) => {
	const { t } = useAppTranslation()
	const { field, defaultExecutable, loginCommand } = CLI_SUBSCRIPTION_CONFIG[kind]
	const name = t(`settings:providers.cliSubscription.${kind}`)

	const handleInput = useCallback(
		(event: Event | React.FormEvent<HTMLElement>) => {
			// Not trimmed here: the field is controlled, so trimming would block typing spaces in a path.
			// The extension trims the value when it looks up the executable.
			const value: string = inputEventTransform(event) ?? ""
			setApiConfigurationField(field, value === "" ? undefined : value)
		},
		[field, setApiConfigurationField],
	)

	return (
		<div className="flex flex-col gap-3">
			<div>
				<VSCodeTextField
					value={apiConfiguration[field] ?? ""}
					onInput={handleInput}
					placeholder={defaultExecutable}
					className="w-full"
					data-testid={`${kind}-executable-path`}>
					<label className="block font-medium mb-1">
						{t("settings:providers.cliSubscription.executablePathLabel")}
					</label>
				</VSCodeTextField>
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.cliSubscription.executablePathDescription", { defaultExecutable })}
				</div>
			</div>
			<div className="text-sm text-vscode-descriptionForeground">
				{t("settings:providers.cliSubscription.howItWorks", { name })}
			</div>
			<div className="text-sm text-vscode-descriptionForeground">
				{t("settings:providers.cliSubscription.setup", { loginCommand })}
			</div>
		</div>
	)
}
