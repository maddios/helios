import type { AccountDestinationResponse, Destination } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Reads and sets the account's default delivery destination, used when a request names none.
 *
 * @example
 * await helios.account.setDestination({ type: "webhook", url: "https://bella.example/hook" });
 */
export class Account {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Gets the default delivery destination. The webhook secret is never returned.
	 *
	 * @returns The destination, or `null` when none is set.
	 * @example
	 * const { destination } = await helios.account.getDestination();
	 */
	getDestination(): Promise<AccountDestinationResponse> {
		return this.transport.json<AccountDestinationResponse>({
			method: "GET",
			retry: "idempotent",
			path: "/account/destination"
		});
	}

	/**
	 * Sets or clears the default delivery destination.
	 *
	 * @param destination Webhook or EventBridge destination, or `null` to clear it.
	 * @returns The stored destination.
	 * @throws {UnprocessableError} When the destination is not allowed, e.g. a private webhook address (422).
	 * @example
	 * await helios.account.setDestination(null); // clear it
	 */
	setDestination(destination: Destination | null): Promise<AccountDestinationResponse> {
		return this.transport.json<AccountDestinationResponse>({
			method: "PUT",
			retry: "idempotent",
			path: "/account/destination",
			body: { destination }
		});
	}
}
