import { openAiModelInfoSaneDefaults } from "@roo-code/types"

import { BaseProvider } from "./base-provider"

const retirementMessage = "Zoo Gateway has been retired. Select and configure a different provider in your API profile."

/** Keep saved tasks readable and reject inference until the user selects a different provider. */
export class RetiredZooGatewayHandler extends BaseProvider {
	constructor(private readonly modelId: string | undefined) {
		super()
	}

	getModel() {
		return { id: this.modelId ?? "", info: openAiModelInfoSaneDefaults }
	}

	createMessage(): never {
		throw new Error(retirementMessage)
	}

	async completePrompt(): Promise<never> {
		throw new Error(retirementMessage)
	}
}
