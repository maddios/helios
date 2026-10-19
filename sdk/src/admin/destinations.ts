import type { Destination, DestinationTestResult } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Sends test events to an account's destination on the admin's behalf.
 *
 * @example
 * const result = await admin.destinations.test(account.id);
 */
export class AdminDestinations {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Sends a `helios.test` event to an account's destination, or to a destination you pass.
	 *
	 * A failed delivery is reported in the result, not thrown.
	 *
	 * @param accountId Account id.
	 * @param destination Destination to test. Defaults to the account destination.
	 * @returns The test result.
	 * @throws {NotFoundError} When the account does not exist (404).
	 * @example
	 * await admin.destinations.test(account.id, { type: "webhook", url: "https://novel.example/hook" });
	 */
	test(accountId: string, destination?: Destination): Promise<DestinationTestResult> {
		return this.transport.json<DestinationTestResult>({
			method: "POST",
			retry: "rateLimitOnly",
			path: `/admin/accounts/${encodeURIComponent(accountId)}/destinations/test`,
			body: destination === undefined ? {} : { destination }
		});
	}
}
