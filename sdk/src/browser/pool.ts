/**
 * Runs `worker` over every item with at most `concurrency` calls in flight. The first failure aborts `controller`, which
 * stops new items and cancels calls in flight. The first failure is thrown once every call has settled.
 *
 * @param items The items, processed in order.
 * @param concurrency Maximum number of concurrent calls.
 * @param controller Aborted on the first failure; the worker should watch its signal.
 * @param worker Processes one item.
 * @throws The first error thrown by `worker`.
 */
export async function runWithConcurrency<T>(
	items: readonly T[],
	concurrency: number,
	controller: AbortController,
	worker: (item: T) => Promise<void>
): Promise<void> {
	let failure: { error: unknown } | undefined;
	let next = 0;
	const lane = async (): Promise<void> => {
		while (failure === undefined && !controller.signal.aborted && next < items.length) {
			const item = items[next++];
			try {
				await worker(item);
			} catch (error) {
				failure ??= { error };
				controller.abort(error);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
	if (failure !== undefined) {
		throw failure.error;
	}
}

/**
 * Forwards an external abort to a controller. Returns the function that removes the listener.
 *
 * @param signal The caller's signal, if any.
 * @param controller The controller that follows it.
 * @returns A function that detaches the listener.
 */
export function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
	if (signal === undefined) {
		return () => undefined;
	}
	const onAbort = (): void => controller.abort(signal.reason);
	if (signal.aborted) {
		onAbort();
	} else {
		signal.addEventListener("abort", onAbort, { once: true });
	}
	return () => signal.removeEventListener("abort", onAbort);
}
