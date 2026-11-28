// pnpm --filter @roo-code/cli test src/ui/hooks/__tests__/useMessageHandlers.test.tsx

import { render } from "ink-testing-library"

import type { ClineAsk, ExtensionMessage } from "@roo-code/types"

import { useCLIStore } from "../../store.js"
import { useMessageHandlers } from "../useMessageHandlers.js"

let handleExtensionMessage: (msg: ExtensionMessage) => void = () => {}

function Harness({ nonInteractive }: { nonInteractive: boolean }) {
	handleExtensionMessage = useMessageHandlers({ nonInteractive }).handleExtensionMessage
	return null
}

const askMessage = (ask: ClineAsk, ts: number): ExtensionMessage => ({
	type: "messageUpdated",
	clineMessage: { ts, type: "ask", ask, text: "details", partial: false },
})

describe("useMessageHandlers – asks in non-interactive mode", () => {
	beforeEach(() => useCLIStore.getState().reset())

	it.each<ClineAsk>(["api_req_failed", "mistake_limit_reached", "auto_approval_max_req_reached"])(
		"shows the approval prompt for %s, which the extension never answers itself",
		(ask) => {
			render(<Harness nonInteractive />)

			handleExtensionMessage(askMessage(ask, 1))

			expect(useCLIStore.getState().pendingAsk).toMatchObject({ id: "1", type: ask })
		},
	)

	it("does not prompt for a tool ask, which the extension auto-approves", () => {
		render(<Harness nonInteractive />)

		handleExtensionMessage(askMessage("tool", 2))

		expect(useCLIStore.getState().pendingAsk).toBeNull()
	})
})
