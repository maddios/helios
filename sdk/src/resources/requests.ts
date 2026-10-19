import type { RequestView } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";
import { waitForRequest, type WaitOptions } from "../wait.js";
import { RequestCallbacks } from "./callbacks.js";

/**
 * Reads, cancels and waits for encode, re-encode and post-process requests.
 *
 * @example
 * const finished = await helios.requests.wait(request.id, { timeoutMs: 600_000 });
 */
export class Requests {
	/** Callback deliveries of the requests. */
	readonly callbacks: RequestCallbacks;

	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {
		this.callbacks = new RequestCallbacks(transport);
	}

	/**
	 * Gets a request with its items and progress.
	 *
	 * @param id Request id.
	 * @param options Optional cancellation signal.
	 * @returns The request.
	 * @throws {NotFoundError} When the request does not exist for this account (404).
	 * @example
	 * const request = await helios.requests.get(requestId);
	 */
	get(id: string, options: { signal?: AbortSignal } = {}): Promise<RequestView> {
		return this.transport.json<RequestView>({
			method: "GET",
			retry: "idempotent",
			path: `/requests/${encodeURIComponent(id)}`,
			signal: options.signal
		});
	}

	/**
	 * Cancels a request. Pending items are cancelled; work already running may finish.
	 *
	 * @param id Request id.
	 * @returns The cancelled request.
	 * @throws {NotFoundError} When the request does not exist for this account (404).
	 * @throws {ConflictError} When the request has already finished (409).
	 * @example
	 * await helios.requests.cancel(request.id);
	 */
	cancel(id: string): Promise<RequestView> {
		return this.transport.json<RequestView>({
			method: "DELETE",
			retry: "idempotent",
			path: `/requests/${encodeURIComponent(id)}`
		});
	}

	/**
	 * Polls a request with exponential backoff until it reaches `COMPLETE`, `ERROR` or `CANCELLED`.
	 *
	 * @param id Request id.
	 * @param options Timeout (default 900000 ms), first poll interval (default 1000 ms) and cancellation.
	 * @returns The request in its terminal state. Check `status` for `ERROR`.
	 * @throws {TimeoutError} When the request is still running after `timeoutMs`.
	 * @throws {AbortedError} When `signal` fires.
	 * @example
	 * const done = await helios.requests.wait(request.id, { timeoutMs: 10 * 60_000 });
	 * if (done.status === "ERROR") console.error(done.error);
	 */
	wait(id: string, options: WaitOptions = {}): Promise<RequestView> {
		return waitForRequest(id, (signal) => this.get(id, { signal }), options);
	}
}
