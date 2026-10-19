import { TimeoutError } from "./errors.js";
import { sleep } from "./sleep.js";
import type { RequestStatus, RequestView } from "./types.js";

/** Options of `requests.wait`. */
export interface WaitOptions {
	/** Give up after this many milliseconds. Defaults to 900000 (15 minutes). */
	timeoutMs?: number;
	/** Delay before the first poll, in milliseconds. Grows by 1.5x per poll up to 10 seconds. Defaults to 1000. */
	intervalMs?: number;
	/** Cancels the wait. */
	signal?: AbortSignal;
}

const TERMINAL_STATUSES: ReadonlySet<RequestStatus> = new Set(["COMPLETE", "ERROR", "CANCELLED"]);
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 10_000;
const BACKOFF_FACTOR = 1.5;

/**
 * Polls a request until it reaches a terminal status (`COMPLETE`, `ERROR` or `CANCELLED`).
 *
 * @param id Request id, used in the timeout message.
 * @param poll Fetches the current request state.
 * @param options Timeout, interval and cancellation.
 * @returns The request in its terminal state. A failed request is returned, not thrown; check `status`.
 * @throws {TimeoutError} When the request is still running after `timeoutMs`.
 */
export async function waitForRequest(
	id: string,
	poll: (signal?: AbortSignal) => Promise<RequestView>,
	options: WaitOptions
): Promise<RequestView> {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS, signal } = options;
	const deadline = Date.now() + timeoutMs;
	let delay = intervalMs;
	for (;;) {
		const view = await poll(signal);
		if (TERMINAL_STATUSES.has(view.status)) {
			return view;
		}
		if (Date.now() + delay > deadline) {
			throw new TimeoutError("timeout", `Request ${id} did not finish within ${timeoutMs} ms`, {
				details: { requestId: id, status: view.status }
			});
		}
		await sleep(delay, signal);
		delay = Math.min(delay * BACKOFF_FACTOR, MAX_INTERVAL_MS);
	}
}
