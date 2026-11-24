import { defineConfig, mergeConfig } from "vitest/config"

import baseConfig from "./vitest.config"
import workflowTestFiles from "./vitest.workflow-files.json"

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			include: workflowTestFiles,
			coverage: {
				reportsDirectory: "coverage/workflow",
			},
		},
	}),
)
