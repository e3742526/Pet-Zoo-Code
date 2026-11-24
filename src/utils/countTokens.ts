import { Anthropic } from "@anthropic-ai/sdk"
import workerpool from "workerpool"

import { countTokensResultSchema } from "../workers/types"

let pool: workerpool.Pool | null | undefined = undefined

async function countTokensInMainThread(content: Anthropic.Messages.ContentBlockParam[]): Promise<number> {
	const { tiktoken } = await import("./tiktoken")
	return tiktoken(content)
}

export async function terminateCountTokensPool(): Promise<void> {
	const currentPool = pool
	pool = undefined
	if (currentPool) {
		await currentPool.terminate()
	}
}

export type CountTokensOptions = {
	useWorker?: boolean
}

export async function countTokens(
	content: Anthropic.Messages.ContentBlockParam[],
	{ useWorker = true }: CountTokensOptions = {},
): Promise<number> {
	// Lazily create the worker pool if it doesn't exist.
	if (useWorker && typeof pool === "undefined") {
		pool = workerpool.pool(__dirname + "/workers/countTokens.js", {
			maxWorkers: 1,
			maxQueueSize: 10,
		})
	}

	// If the worker pool doesn't exist or the caller doesn't want to use it
	// then, use the non-worker implementation.
	if (!useWorker || !pool) {
		return countTokensInMainThread(content)
	}

	try {
		const data = await pool.exec("countTokens", [content])
		const result = countTokensResultSchema.parse(data)

		if (!result.success) {
			throw new Error(result.error)
		}

		return result.count
	} catch (error) {
		const failedPool = pool
		pool = null
		void failedPool?.terminate()
		console.error(error)
		return countTokensInMainThread(content)
	}
}
