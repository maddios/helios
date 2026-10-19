import type { UsageQuery, UsageResponse } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Reads the account's resource usage: requests, compute, output storage and transcription.
 *
 * @example
 * const usage = await helios.usage.get({ from: "2026-10-01", to: "2026-10-31" });
 */
export class Usage {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Gets usage for a date range, broken down by day.
	 *
	 * @param query Inclusive `from` and `to` dates as `YYYY-MM-DD`; the range may span at most 366 days.
	 * @returns Totals for the range and one entry per day.
	 * @throws {ValidationError} When the dates are malformed, reversed, or the range is longer than 366 days (400).
	 * @example
	 * const { requests, units } = await helios.usage.get({ from: "2026-10-01", to: "2026-10-07" });
	 */
	get(query: UsageQuery): Promise<UsageResponse> {
		return this.transport.json<UsageResponse>({ method: "GET", retry: "idempotent", path: "/usage", query });
	}
}
