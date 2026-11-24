import { providerIdentifiers } from "@roo-code/types"

import { readRetainedOrganizationPolicy } from "../retainedOrganizationPolicy"

const savedPolicy = {
	version: 2,
	allowList: { allowAll: false, providers: { [providerIdentifiers.ollama]: { allowAll: true } } },
}

const staticPolicy = {
	version: 3,
	allowList: { allowAll: false, providers: {} },
}

describe("retained organization provider policy", () => {
	afterEach(() => vi.unstubAllEnvs())

	it.each([
		["uses the saved policy with no environment override", undefined, savedPolicy],
		[
			"gives environment restrictions precedence",
			Buffer.from(JSON.stringify(staticPolicy)).toString("base64"),
			staticPolicy,
		],
		["keeps the saved restrictions if the override is invalid", "invalid", savedPolicy],
	])("%s", (_label, override, expected) => {
		vi.stubEnv("ROO_CODE_CLOUD_ORG_SETTINGS", override)
		const state = { get: vi.fn().mockReturnValue(savedPolicy) }

		expect(readRetainedOrganizationPolicy(state, vi.fn())).toEqual(expected)
	})
})
