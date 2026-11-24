import { organizationAllowListSchema } from "@roo-code/types"
import { z } from "zod"

const policySchema = z.object({
	allowList: organizationAllowListSchema,
	version: z.number().optional(),
})

export function readRetainedOrganizationPolicy(state: { get(key: string): unknown }, log: (message: string) => void) {
	// Preserve machine-supplied restrictions ahead of the last policy saved by Roo Cloud.
	const staticSettings = process.env.ROO_CODE_CLOUD_ORG_SETTINGS
	if (staticSettings) {
		try {
			return policySchema.parse(JSON.parse(Buffer.from(staticSettings, "base64").toString("utf8")))
		} catch {
			log("[MDM] Invalid static organization settings. Checking the saved provider policy.")
		}
	}

	const cachedPolicy = policySchema.safeParse(state.get("organization-settings"))
	return cachedPolicy.success ? cachedPolicy.data : undefined
}
