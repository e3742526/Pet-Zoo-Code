// pnpm --filter @roo-code/cli test src/agent/__tests__/prompt-manager.test.ts

import { PassThrough } from "stream"

import { PromptManager } from "../prompt-manager.js"

function createPromptManager() {
	// PassThrough streams stand in for the terminal. readline needs only the stream methods they provide.
	const stdin = new PassThrough() as unknown as NodeJS.ReadStream
	const stdout = new PassThrough() as unknown as NodeJS.WriteStream
	const onBeforePrompt = vi.fn()
	const onAfterPrompt = vi.fn()
	const promptManager = new PromptManager({ stdin, stdout, onBeforePrompt, onAfterPrompt })
	return { promptManager, stdin, onAfterPrompt }
}

describe("PromptManager.promptForInput", () => {
	it("resolves with the answer and restores output once", async () => {
		const { promptManager, stdin, onAfterPrompt } = createPromptManager()

		const answer = promptManager.promptForInput("Question: ")
		stdin.write("yes\n")

		await expect(answer).resolves.toBe("yes")
		expect(onAfterPrompt).toHaveBeenCalledTimes(1)
		expect(promptManager.isActive()).toBe(false)
	})

	it("rejects when input ends before an answer", async () => {
		const { promptManager, stdin, onAfterPrompt } = createPromptManager()

		const answer = promptManager.promptForInput("Question: ")
		stdin.end()

		await expect(answer).rejects.toThrow("Input closed before an answer was given")
		expect(onAfterPrompt).toHaveBeenCalledTimes(1)
		expect(promptManager.isActive()).toBe(false)
	})
})
