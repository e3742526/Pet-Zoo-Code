import { providerIdentifiers, type ClineMessage, type ExtensionMessage, type HistoryItem } from "@roo-code/types"

import { useExtensionState } from "@/context/ExtensionStateContext"
import { act, fireEvent, renderWithExtensionState, screen } from "@/utils/test-utils"

import TaskHeader from "../TaskHeader"

let headerRenders = 0

vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => {
		headerRenders++
		return { id: "test-model", info: { contextWindow: 4000, maxTokens: 1000 } }
	},
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const task: ClineMessage = {
	ts: new Date(2024, 2, 7, 14, 41).getTime(),
	type: "say",
	say: "text",
	text: "Test task",
}
const item: HistoryItem = {
	id: "task-1",
	number: 1,
	ts: task.ts,
	task: "Test task",
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.05,
	size: 1024,
}
const tail: ClineMessage = { ts: task.ts + 1, type: "say", say: "text", text: "Starting", partial: true }
const handleCondenseContext = vi.fn()

function StreamingTask() {
	const { clineMessages, apiConfiguration, currentTaskItem, dateFormat, timeFormat, debug } = useExtensionState()
	const headerState = { apiConfiguration, currentTaskItem, dateFormat, timeFormat, debug }
	return (
		<>
			<TaskHeader
				{...headerState}
				task={task}
				tokensIn={100}
				tokensOut={50}
				totalCost={0.05}
				contextTokens={150}
				buttonsDisabled={false}
				handleCondenseContext={handleCondenseContext}
			/>
			<output>{clineMessages.at(-1)?.text}</output>
		</>
	)
}

function postMessage(data: ExtensionMessage) {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data }))
	})
}

it("updates streamed text without rendering the header and still applies header changes", () => {
	renderWithExtensionState(<StreamingTask />, {
		state: {
			clineMessages: [task, tail],
			apiConfiguration: { apiProvider: providerIdentifiers.anthropic },
			currentTaskItem: item,
			dateFormat: "ymd",
			timeFormat: "24h",
		},
	})
	fireEvent.click(screen.getByText("Test task"))
	const rendersBeforeStream = headerRenders
	expect(screen.getByTestId("message-timestamp")).toHaveTextContent("14:41")

	postMessage({ type: "messageUpdated", clineMessage: { ...tail, text: "Later" } })
	postMessage({ type: "messageUpdated", clineMessage: { ...tail, text: "Latest" } })
	expect(screen.getByText("Latest")).toBeVisible()
	expect(headerRenders).toBe(rendersBeforeStream)

	postMessage({
		type: "state",
		state: {
			currentTaskItem: { ...item, title: "Renamed task" },
			timeFormat: "12h",
			dateFormat: "dmy",
			debug: true,
		},
	})
	expect(screen.getByText("Renamed task")).toBeVisible()
	expect(screen.getByTestId("message-timestamp")).toHaveTextContent("07/03/2024")
	expect(screen.getByTestId("message-timestamp")).toHaveTextContent(/2:41\s?PM/i)
	expect(screen.getByRole("button", { name: "chat:task.openApiHistory" })).toBeVisible()
})
