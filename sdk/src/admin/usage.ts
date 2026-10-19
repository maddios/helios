import type { AdminUsageResponse, UsageQuery } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Reads resource usage across every account.
 *
 * @example
 * const { accounts } = await admin.usage.get({ from: "2026-10-01", to: "2026-10-31" });
 */
export class AdminUsage {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Gets usage for every account over a date range.
	 *
	 * @param query Inclusive `from` and `to` dates as `YYYY-MM-DD`; the range may span at most 366 days.
	 * @returns Requests and units per account.
	 * @throws {ValidationError} When the dates are malformed, reversed, or the range is longer than 366 days (400).
	 * @example
	 * const usage = await admin.usage.get({ from: "2026-10-01", to: "2026-10-07" });
	 */
	get(query: UsageQuery): Promise<AdminUsageResponse> {
		return this.transport.json<AdminUsageResponse>({ method: "GET", retry: "idempotent", path: "/admin/usage", query });
	}
}
