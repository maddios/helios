/**
 * Runs `worker` over every item with at most `concurrency` calls in flight.
 *
 * The first failure, from the worker or from the item source, stops new items from starting. Calls already running are
 * awaited before the error is thrown, so the caller can clean up without racing a part that is still uploading.
 *
 * @param items Items to process, pulled lazily in order.
 * @param concurrency Maximum number of concurrent calls.
 * @param worker Processes one item; receives its zero-based index.
 * @throws The first error thrown by `worker` or by `items`.
 */
export async function forEachBounded<T>(
	items: AsyncIterable<T>,
	concurrency: number,
	worker: (item: T, index: number) => Promise<void>
): Promise<void> {
	const running = new Set<Promise<void>>();
	let failure: { error: unknown } | undefined;
	let index = 0;
	try {
		for await (const item of items) {
			while (running.size >= concurrency && failure === undefined) {
				await Promise.race(running);
			}
			if (failure !== undefined) {
				break;
			}
			const task: Promise<void> = worker(item, index++)
				.catch((error: unknown) => {
					failure ??= { error };
				})
				.finally(() => running.delete(task));
			running.add(task);
		}
	} catch (error) {
		failure ??= { error };
	} finally {
		await Promise.all(running);
	}
	if (failure !== undefined) {
		throw failure.error;
	}
}
