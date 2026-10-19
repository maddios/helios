import type { DryRunResponse, RequestView } from "@helios/contracts";
import { withIdempotencyKey } from "../idempotency.js";
import type { Transport } from "../transport/transport.js";
import type { EncodeRequest, ReencodeRequest } from "../types.js";

/** Options of `encodes.create`. */
export interface CreateEncodeOptions {
	/** Plan the request without creating it; the response lists the items it would create. Defaults to `false`. */
	dryRun?: boolean;
	/** Cancels the call. A create that was already accepted is not undone; retry it with the same `requestId`. */
	signal?: AbortSignal;
}

/**
 * Starts encode requests, including dry runs and re-encodes of existing assets.
 *
 * Creates generate an idempotency key once per call, so retries never duplicate work.
 *
 * @example
 * const request = await helios.encodes.create({ source: { bucket, key }, preset: "generic" });
 */
export class Encodes {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Creates an encode request, or plans one when `dryRun` is `true`.
	 *
	 * A `requestId` is generated when the body has none, so retries reuse it. Pass your own `requestId` (a UUID) to make
	 * the call idempotent across process restarts.
	 *
	 * @param request Source, preset, optional post-processing, destination and analysis mode.
	 * @param options Set `dryRun: true` to plan without creating.
	 * @returns The created request (HTTP 201 or 202, or the repeated request on a retry), or the planned items for a dry run.
	 * @throws {ValidationError} When the body is invalid (400).
	 * @throws {NotFoundError} When the preset does not exist (404).
	 * @throws {UnprocessableError} When the source is unfetchable or nothing needs encoding (422).
	 * @example
	 * const plan = await helios.encodes.create({ source, preset: "generic" }, { dryRun: true });
	 * console.log(plan.items.map((item) => item.key));
	 */
	create(request: EncodeRequest, options: CreateEncodeOptions & { dryRun: true }): Promise<DryRunResponse>;
	/**
	 * Creates an encode request, returning the request in its initial state.
	 *
	 * @param request Source, preset and optional post-processing.
	 * @param options Leave `dryRun` unset or `false`.
	 * @returns The created request.
	 * @throws {ValidationError} When the body is invalid (400).
	 * @throws {NotFoundError} When the preset does not exist (404).
	 * @throws {UnprocessableError} When the source is unfetchable (422).
	 */
	create(request: EncodeRequest, options?: CreateEncodeOptions & { dryRun?: false }): Promise<RequestView>;
	/**
	 * Creates an encode request, or plans one when `dryRun` is decided at runtime.
	 *
	 * @param request Source, preset and optional post-processing.
	 * @param options Set `dryRun` to plan instead of creating.
	 * @returns The created request, or the planned items when `dryRun` is `true`.
	 * @throws {ValidationError} When the body is invalid (400).
	 * @throws {NotFoundError} When the preset does not exist (404).
	 * @throws {UnprocessableError} When the source is unfetchable (422).
	 */
	create(request: EncodeRequest, options?: CreateEncodeOptions): Promise<RequestView | DryRunResponse>;
	create(request: EncodeRequest, options: CreateEncodeOptions = {}): Promise<RequestView | DryRunResponse> {
		if (options.dryRun === true) {
			return this.transport.json<DryRunResponse>({
				method: "POST",
				retry: "idempotent",
				path: "/encode",
				query: { dryRun: true },
				body: request,
				signal: options.signal
			});
		}
		return this.transport.json<RequestView>({
			method: "POST",
			path: "/encode",
			body: withIdempotencyKey(request),
			retry: "idempotent",
			signal: options.signal
		});
	}

	/**
	 * Re-encodes an existing asset, bumping its version.
	 *
	 * @param assetId Id of the asset to re-encode.
	 * @param request Optional `refreshPreset` (re-resolve the preset first), `requestId` and destination.
	 * @returns The re-encode request.
	 * @throws {NotFoundError} When the asset does not exist (404).
	 * @throws {ConflictError} When the asset already has a pending request (409).
	 * @example
	 * await helios.encodes.reencode(asset.id, { refreshPreset: true });
	 */
	reencode(assetId: string, request: ReencodeRequest = {}): Promise<RequestView> {
		return this.transport.json<RequestView>({
			method: "POST",
			path: `/assets/${encodeURIComponent(assetId)}/re-encode`,
			body: withIdempotencyKey(request),
			retry: "idempotent"
		});
	}
}
