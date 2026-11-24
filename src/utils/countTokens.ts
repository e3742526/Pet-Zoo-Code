import { Anthropic } from "@anthropic-ai/sdk"
import workerpool from "workerpool"

import { countTokensResultSchema } from "../workers/types"

let pool: workerpool.Pool | null | undefined = undefined

async function stopPool(currentPool: workerpool.Pool): Promise<void> {
	try {
		await currentPool.terminate(true, 3_000)
	} catch (error) {
		console.error(error)
	}
}

async function countTokensInMainThread(content: Anthropic.Messages.ContentBlockParam[]): Promise<number> {
	const { tiktoken } = await import("./tiktoken")
	return tiktoken(content)
}

export async function terminateCountTokensPool(): Promise<void> {
	const currentPool = pool
	pool = undefined
	if (currentPool) {
		await stopPool(currentPool)
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
		// Let the worker drain bursts in order. A queue-limit rejection would
		// stop the pool and move all pending counts onto the host.
		pool = workerpool.pool(__dirname + "/workers/countTokens.js", {
			maxWorkers: 1,
		})
	}

	// If the worker pool doesn't exist or the caller doesn't want to use it
	// then, use the non-worker implementation.
	const currentPool = pool
	if (!useWorker || !currentPool) {
		return countTokensInMainThread(content)
	}

	try {
		const data = await currentPool.exec("countTokens", [content])
		const result = countTokensResultSchema.parse(data)

		if (!result.success) {
			throw new Error(result.error)
		}

		return result.count
	} catch (error) {
		if (pool === currentPool) {
			pool = null
			void stopPool(currentPool)
		}
		console.error(error)
		return countTokensInMainThread(content)
	}
}
