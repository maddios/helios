import { abortedError } from "./errors.js";

/**
 * Waits for a delay, and rejects early when the signal fires.
 *
 * @param ms Delay in milliseconds.
 * @param signal Cancels the wait.
 * @returns Resolves after the delay.
 * @throws {BrowserUploadError} With code `aborted` when the signal fires first.
 */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(abortedError(signal.reason));
			return;
		}
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(abortedError(signal.reason));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
