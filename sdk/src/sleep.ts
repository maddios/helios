import { AbortedError } from "./errors.js";

/**
 * Waits for a delay, which the caller's signal can cut short.
 *
 * @param ms Delay in milliseconds.
 * @param signal Cancels the wait.
 * @returns Resolves after the delay.
 * @throws {AbortedError} When the signal has fired, before or during the wait.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new AbortedError("aborted", "The operation was aborted"));
			return;
		}
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new AbortedError("aborted", "The operation was aborted"));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
