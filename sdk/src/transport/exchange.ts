import { AbortedError, ConnectionError, TimeoutError, type HeliosError } from "../errors.js";
import type { FetchFn } from "../options.js";

/** A fully read HTTP response. */
export interface RawResponse {
	status: number;
	headers: Headers;
	text: string;
}

/**
 * Performs one HTTP attempt with a timeout, reading the whole body.
 *
 * The attempt is cancelled by the timeout or by the caller's signal, whichever fires first. Listeners are removed when
 * the attempt ends, so a long-lived caller signal does not accumulate them.
 *
 * @param fetchFn The fetch implementation.
 * @param url Absolute URL to call.
 * @param init Method, headers and body of the request.
 * @param timeoutMs Timeout of this attempt, in milliseconds.
 * @param signal Caller cancellation, if any.
 * @returns The status, headers and body text.
 * @throws {AbortedError} When the caller's signal fired.
 * @throws {TimeoutError} When the attempt timed out.
 * @throws {ConnectionError} When the API could not be reached.
 */
export async function exchange(
	fetchFn: FetchFn,
	url: string,
	init: RequestInit,
	timeoutMs: number,
	signal?: AbortSignal
): Promise<RawResponse> {
	if (signal?.aborted) {
		throw new AbortedError("aborted", "The request was aborted");
	}
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new DOMException("The request timed out", "TimeoutError")),
		timeoutMs
	);
	const cancel = (): void => controller.abort(signal?.reason);
	signal?.addEventListener("abort", cancel, { once: true });
	try {
		const res = await fetchFn(url, { ...init, signal: controller.signal });
		return { status: res.status, headers: res.headers, text: await res.text() };
	} catch (err) {
		throw failureOf(err, signal);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", cancel);
	}
}

function failureOf(err: unknown, signal?: AbortSignal): HeliosError {
	if (signal?.aborted) {
		return new AbortedError("aborted", "The request was aborted", { cause: err });
	}
	if (nameOf(err) === "TimeoutError") {
		return new TimeoutError("timeout", "The request timed out", { cause: err });
	}
	return new ConnectionError("network_error", "The Helios API could not be reached", { cause: err });
}

function nameOf(err: unknown): unknown {
	return typeof err === "object" && err !== null && "name" in err ? err.name : undefined;
}
