import type { AccountDestinationResponse, Destination, UploadPolicy } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Reads and sets the account's default delivery destination, and its upload policy.
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

	/**
	 * Gets the upload policy in effect: the content types uploads may use and the largest file allowed.
	 *
	 * @returns The effective policy, with the default applied when none was set.
	 * @example
	 * const policy = await helios.account.getUploadPolicy();
	 */
	getUploadPolicy(): Promise<UploadPolicy> {
		return this.transport.json<UploadPolicy>({
			method: "GET",
			retry: "idempotent",
			path: "/account/upload-policy"
		});
	}

	/**
	 * Sets the upload policy. Uploads may narrow it per request, never widen it.
	 *
	 * @param policy Allowed content types (exact, `type/*` or `*\/*`) and the largest file in bytes.
	 * @returns The policy in effect.
	 * @throws {ValidationError} When maxBytes is above the server limit or a pattern is malformed (400).
	 * @example
	 * await helios.account.setUploadPolicy({ allowedContentTypes: ["image/*", "video/mp4"], maxBytes: 5 * 1024 ** 3 });
	 */
	setUploadPolicy(policy: UploadPolicy): Promise<UploadPolicy> {
		return this.transport.json<UploadPolicy>({
			method: "PATCH",
			retry: "idempotent",
			path: "/account/upload-policy",
			body: policy
		});
	}
}
