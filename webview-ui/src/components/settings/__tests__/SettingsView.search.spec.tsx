import { afterEach, beforeAll, expect, it, vi } from "vitest"
import { createInstance } from "i18next"

import type { ExtensionState } from "@roo-code/types"

import { act, fireEvent, renderWithExtensionState, screen, waitFor } from "@/utils/test-utils"
import { vscode } from "@/utils/vscode"
import { createInitialExtensionState } from "@/context/ExtensionStateContext"
import { TranslationContext } from "@/i18n/TranslationContext"
import enSettings from "@/i18n/locales/en/settings.json"
import esSettings from "@/i18n/locales/es/settings.json"

import SettingsView, { sectionNames } from "../SettingsView"
import { buildSettingsSearchIndex } from "../settingsSearchIndex"

const translator = createInstance()
beforeAll(async () => {
	await translator.init({
		lng: "en",
		fallbackLng: "en",
		resources: { en: { settings: enSettings }, es: { settings: esSettings } },
	})
})

afterEach(() => vi.restoreAllMocks())

it("opens the requested tab without asking the host to load other settings tabs", () => {
	const send = vi.spyOn(vscode, "postMessage").mockImplementation(() => {})
	renderWithExtensionState(<SettingsView targetSection="language" onDone={vi.fn()} />)

	expect(screen.getByTestId("settings-search-input")).toBeInTheDocument()
	expect(document.querySelector('[data-setting-id="language-time-format"]')).toBeVisible()
	const requests = send.mock.calls.map(([message]) => message.type)
	for (const request of ["requestCommands", "requestSkills", "requestTerminalProfiles", "listWorktrees"]) {
		expect(requests).not.toContain(request)
	}
})

it("finds a setting in an unvisited tab and opens that tab without a save", async () => {
	const send = vi.spyOn(vscode, "postMessage").mockImplementation(() => {})
	renderWithExtensionState(<SettingsView targetSection="language" onDone={vi.fn()} />)
	const input = screen.getByTestId("settings-search-input")

	expect(document.querySelector('[data-setting-id="ui-chat-font-size"]')).toBeNull()
	fireEvent.focus(input)
	fireEvent.change(input, { target: { value: "chatFontSize" } })
	await waitFor(() => expect(document.getElementById("settings-search-result-ui-chat-font-size")).toBeVisible())
	fireEvent.click(document.getElementById("settings-search-result-ui-chat-font-size")!)

	expect(document.querySelector('[data-setting-id="ui-chat-font-size"]')).toBeVisible()
	expect(send.mock.calls.map(([message]) => message.type)).not.toContain("updateSettings")
})

it("keeps the search results open when focus returns before the pending close", () => {
	vi.useFakeTimers()
	try {
		renderWithExtensionState(<SettingsView targetSection="language" onDone={vi.fn()} />)
		const input = screen.getByTestId("settings-search-input")
		fireEvent.focus(input)
		fireEvent.change(input, { target: { value: "chatFontSize" } })
		expect(screen.getByRole("listbox")).toBeVisible()

		fireEvent.blur(input)
		fireEvent.focus(input)
		act(() => vi.advanceTimersByTime(200))
		expect(screen.getByRole("listbox")).toBeVisible()

		fireEvent.blur(input)
		act(() => vi.advanceTimersByTime(200))
		expect(screen.queryByRole("listbox")).toBeNull()
	} finally {
		vi.useRealTimers()
	}
})

const enabledOptions = {
	alwaysAllowReadOnly: true,
	alwaysAllowWrite: true,
	alwaysAllowFollowupQuestions: true,
	alwaysAllowExecute: true,
	enableCheckpoints: true,
	ttsEnabled: true,
	soundEnabled: true,
	terminalShellIntegrationDisabled: false,
} satisfies Partial<ExtensionState>

it.each([
	{
		name: "conditional controls disabled",
		state: { enableCheckpoints: false, terminalShellIntegrationDisabled: true },
	},
	{ name: "conditional controls enabled", state: { ...enabledOptions, destructiveCommandGuardEnabled: false } },
	{ name: "command guard enabled", state: { ...enabledOptions, destructiveCommandGuardEnabled: true } },
])("indexes the settings rendered in each tab with $name", ({ state: overrides }) => {
	vi.spyOn(vscode, "postMessage").mockImplementation(() => {})
	const state = { ...createInitialExtensionState(), ...overrides }
	const index = buildSettingsSearchIndex(sectionNames, translator.getFixedT("en"), state)
	const onDone = vi.fn()
	const { rerender } = renderWithExtensionState(<SettingsView targetSection="language" onDone={onDone} />, { state })

	for (const section of sectionNames) {
		rerender(<SettingsView targetSection={section} onDone={onDone} />)
		const controls = screen.getByTestId("settings-content").querySelectorAll("[data-setting-id]")
		const indexedControls = index.filter(
			(entry) => entry.section === section && entry.settingId !== `tab-${section}`,
		)
		expect(
			Array.from(controls, (control) => control.getAttribute("data-setting-id")),
			section,
		).toEqual(indexedControls.map(({ settingId }) => settingId))
	}
})

it("refreshes search labels when the display language changes", () => {
	vi.spyOn(vscode, "postMessage").mockImplementation(() => {})
	const onDone = vi.fn()
	const view = (language: string) => (
		<TranslationContext.Provider value={{ t: translator.getFixedT(language), language }}>
			<SettingsView targetSection="language" onDone={onDone} />
		</TranslationContext.Provider>
	)
	const { rerender } = renderWithExtensionState(view("en"))
	const input = screen.getByTestId("settings-search-input")
	const fontSizeResult = () => document.getElementById("settings-search-result-ui-chat-font-size")

	fireEvent.focus(input)
	fireEvent.change(input, { target: { value: enSettings.ui.chatFontSize.label } })
	expect(fontSizeResult()).toHaveTextContent(enSettings.ui.chatFontSize.label)

	rerender(view("es"))
	fireEvent.change(input, { target: { value: esSettings.ui.chatFontSize.label } })
	expect(fontSizeResult()).toHaveTextContent(esSettings.ui.chatFontSize.label)
})
