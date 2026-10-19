import type { HeliosError } from "../errors.js";
import { sleep } from "../sleep.js";

/** Marks a failed attempt that may be retried, carrying the server's `Retry-After` delay when there was one. */
export class RetryableError extends Error {
	/**
	 * @param error The error to throw if no retries remain.
	 * @param retryAfterMs Delay requested by the server, in milliseconds.
	 */
	constructor(
		readonly error: HeliosError,
		readonly retryAfterMs?: number
	) {
		super(error.message);
	}
}

/** Retry configuration for one operation. */
export interface RetryPolicy {
	/** Retries after the first attempt. */
	maxRetries: number;
	/** Base delay of the exponential backoff, in milliseconds. */
	baseDelayMs: number;
	/** Longest server-requested delay that is waited for, in milliseconds. */
	maxRetryAfterMs: number;
	/** Cancels the wait between attempts. */
	signal?: AbortSignal;
}

const MAX_BACKOFF_MS = 8_000;

/**
 * Runs an operation, retrying attempts that throw a {@link RetryableError}.
 *
 * A retry is skipped, and the error thrown at once, when the retries are used up or the server asked for a delay longer
 * than `maxRetryAfterMs`.
 *
 * @param run One attempt of the operation.
 * @param policy Retry limits and the abort signal.
 * @returns The result of the first successful attempt.
 * @throws The wrapped error once retries are exhausted, or any other error immediately.
 */
export async function withRetry<T>(run: () => Promise<T>, policy: RetryPolicy): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await run();
		} catch (err) {
			if (!(err instanceof RetryableError)) {
				throw err;
			}
			if (attempt >= policy.maxRetries || (err.retryAfterMs ?? 0) > policy.maxRetryAfterMs) {
				throw err.error;
			}
			await sleep(err.retryAfterMs ?? backoffMs(policy.baseDelayMs, attempt), policy.signal);
		}
	}
}

function backoffMs(baseDelayMs: number, attempt: number): number {
	return Math.min(baseDelayMs * 2 ** attempt, MAX_BACKOFF_MS);
}

/**
 * Reads a `Retry-After` header, which is either a number of seconds or an HTTP date.
 *
 * @param value The raw header value, or `null` when absent.
 * @param now The current time in milliseconds, injectable for tests.
 * @returns The delay in milliseconds, or `undefined` when the header is absent or unparseable.
 */
export function retryAfterMs(value: string | null, now: number = Date.now()): number | undefined {
	if (value === null) {
		return undefined;
	}
	const seconds = Number(value);
	if (Number.isFinite(seconds)) {
		return Math.max(0, seconds * 1000);
	}
	const date = Date.parse(value);
	return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
