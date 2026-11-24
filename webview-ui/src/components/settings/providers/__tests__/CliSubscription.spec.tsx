import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CliSubscription } from "../CliSubscription"

// Echo interpolation options so assertions can check the values that reach each message.
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
	}),
}))

describe("CliSubscription", () => {
	it.each([
		["museCode", "museCodeExecutablePath", "muse", "muse login"],
		["antigravity", "antigravityExecutablePath", "agy", "agy"],
	] as const)(
		"renders the %s settings and stores the executable path",
		(kind, field, defaultExecutable, loginCommand) => {
			const setApiConfigurationField = vi.fn()
			render(
				<CliSubscription
					kind={kind}
					apiConfiguration={{ [field]: "/opt/bin/cli" }}
					setApiConfigurationField={setApiConfigurationField}
				/>,
			)

			const input = screen.getByTestId(`${kind}-executable-path`)
			expect(input).toHaveValue("/opt/bin/cli")
			expect(input).toHaveAttribute("placeholder", defaultExecutable)
			expect(
				screen.getByText(
					`settings:providers.cliSubscription.executablePathDescription ${JSON.stringify({ defaultExecutable })}`,
				),
			).toBeInTheDocument()
			expect(
				screen.getByText(
					`settings:providers.cliSubscription.howItWorks ${JSON.stringify({ name: `settings:providers.cliSubscription.${kind}` })}`,
				),
			).toBeInTheDocument()
			expect(
				screen.getByText(`settings:providers.cliSubscription.setup ${JSON.stringify({ loginCommand })}`),
			).toBeInTheDocument()

			fireEvent.input(input, { target: { value: "/Applications/My Tools/cli " } })
			expect(setApiConfigurationField).toHaveBeenLastCalledWith(field, "/Applications/My Tools/cli ")

			fireEvent.input(input, { target: { value: "" } })
			expect(setApiConfigurationField).toHaveBeenLastCalledWith(field, undefined)
		},
	)
})
