export async function forEachLimit<T>(
	items: T[],
	limit: number,
	signal: AbortSignal,
	task: (item: T, signal: AbortSignal) => Promise<void>
): Promise<void> {
	const failure = new AbortController();
	const stop = AbortSignal.any([signal, failure.signal]);
	let next = 0;
	const lane = async (): Promise<void> => {
		while (next < items.length) {
			const item = items[next];
			next += 1;
			stop.throwIfAborted();
			try {
				await task(item, stop);
			} catch (error) {
				failure.abort(error);
				throw error;
			}
		}
	};
	const results = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, lane));
	const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
	if (rejected !== undefined) {
		throw rejected.reason;
	}
}
