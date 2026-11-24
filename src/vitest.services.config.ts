import { defineConfig, mergeConfig } from "vitest/config"

import baseConfig from "./vitest.config"
import workflowTestFiles from "./vitest.workflow-files.json"

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			include: ["services/**/*.{test,spec}.{ts,tsx}"],
			exclude: ["services/tree-sitter/**/*.{test,spec}.{ts,tsx}", ...workflowTestFiles],
			coverage: {
				reportsDirectory: "coverage/services",
			},
		},
	}),
)
