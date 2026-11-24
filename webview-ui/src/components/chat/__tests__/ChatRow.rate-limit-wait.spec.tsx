import React from "react"

import type { ClineMessage } from "@roo-code/types"

import { fireEvent, renderWithExtensionState, screen } from "@/utils/test-utils"
import { ChatRowContent } from "../ChatRow"

// Mock i18n
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) => {
			const map: Record<string, string> = {
				"chat:apiRequest.rateLimitWait": "Rate limiting",
				"chat:apiRequest.failed": "API Request Failed",
				"chat:apiRequest.errorTitle": "Provider Error",
				"chat:apiRequest.errorMessage.401": "Couldn't authenticate with provider.",
				"chat:apiRequest.errorMessage.docs": "Docs",
				"chat:errorDetails.title": "Error details",
			}
			return map[key] ?? options?.defaultValue ?? key
		},
	}),
}))

vi.mock("react-i18next", () => ({
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

function renderChatRow(message: ClineMessage) {
	return renderWithExtensionState(
		<ChatRowContent
			message={message}
			isExpanded={false}
			isLast={false}
			isStreaming={false}
			onToggleExpand={() => {}}
			onSuggestionClick={() => {}}
			onBatchFileResponse={() => {}}
			onFollowUpUnmount={() => {}}
			isFollowUpAnswered={false}
		/>,
	)
}

describe("ChatRow - rate limit wait", () => {
	it("renders a non-error progress row for api_req_rate_limit_wait", () => {
		const message: ClineMessage = {
			type: "say",
			say: "api_req_rate_limit_wait",
			ts: Date.now(),
			partial: true,
			text: JSON.stringify({ seconds: 1 }),
		}

		renderChatRow(message)

		expect(screen.getByText("Rate limiting")).toBeInTheDocument()
		// Should show countdown, but should NOT show the error-details affordance.
		expect(screen.getByText("1s")).toBeInTheDocument()
		expect(screen.queryByText("Details")).toBeNull()
	})

	it("renders nothing when rate limit wait is complete", () => {
		const message: ClineMessage = {
			type: "say",
			say: "api_req_rate_limit_wait",
			ts: Date.now(),
			partial: false,
			text: undefined,
		}

		const { container } = renderChatRow(message)

		// The row should be hidden when rate limiting is complete
		expect(screen.queryByText("Rate limiting")).toBeNull()
		// Nothing should be rendered
		expect(container.firstChild).toBeNull()
	})

	it("shows the message for a known API error code", () => {
		const message: ClineMessage = {
			type: "say",
			say: "api_req_retry_delayed",
			ts: Date.now(),
			text: "401 Unauthorized",
		}

		renderChatRow(message)

		expect(screen.getByText("Couldn't authenticate with provider.")).toBeInTheDocument()
		expect(screen.queryByText("API Request Failed")).not.toBeInTheDocument()
	})

	it("shows local details for an unknown API error", () => {
		const message: ClineMessage = {
			type: "say",
			say: "api_req_retry_delayed",
			ts: Date.now(),
			text: "599 Provider returned an unknown error",
		}

		renderChatRow(message)

		expect(screen.getByText("API Request Failed")).toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Docs" })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Error details" }))
		expect(screen.getByRole("dialog")).toHaveTextContent("599 Provider returned an unknown error")
	})
})
