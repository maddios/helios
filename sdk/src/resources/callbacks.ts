import type { CallbackDeliveryListResponse, RedeliverResponse } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Inspects and redelivers the callbacks (webhook or EventBridge deliveries) of a request.
 *
 * @example
 * const { deliveries } = await helios.requests.callbacks.list(request.id);
 */
export class RequestCallbacks {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Lists the delivery attempts of a request's callbacks.
	 *
	 * @param requestId Request id.
	 * @returns The deliveries, with their attempts.
	 * @throws {NotFoundError} When the request does not exist for this account (404).
	 * @example
	 * const { deliveries } = await helios.requests.callbacks.list(request.id);
	 */
	list(requestId: string): Promise<CallbackDeliveryListResponse> {
		return this.transport.json<CallbackDeliveryListResponse>({
			method: "GET",
			retry: "idempotent",
			path: `/requests/${encodeURIComponent(requestId)}/callbacks`
		});
	}

	/**
	 * Queues a redelivery of the final callback of a finished request.
	 *
	 * @param requestId Request id.
	 * @returns The request id, once the redelivery is queued (HTTP 202).
	 * @throws {NotFoundError} When the request does not exist for this account (404).
	 * @throws {ConflictError} When the request has not finished yet (409).
	 * @throws {RateLimitError} When a redelivery was requested too recently (429).
	 * @example
	 * await helios.requests.callbacks.redeliver(request.id);
	 */
	redeliver(requestId: string): Promise<RedeliverResponse> {
		return this.transport.json<RedeliverResponse>({
			method: "POST",
			retry: "rateLimitOnly",
			path: `/requests/${encodeURIComponent(requestId)}/callbacks/redeliver`
		});
	}
}
