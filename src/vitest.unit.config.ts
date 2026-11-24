import { configDefaults, defineConfig, mergeConfig } from "vitest/config"

import baseConfig from "./vitest.config"
import workflowTestFiles from "./vitest.workflow-files.json"

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			exclude: [...configDefaults.exclude, "__tests__/dist_assets.spec.ts", ...workflowTestFiles],
			coverage: {
				reportsDirectory: "coverage/unit",
			},
		},
	}),
)
