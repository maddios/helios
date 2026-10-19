import type { ApiKeyCreated, CreateApiKeyRequest } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Issues and revokes account API keys.
 *
 * @example
 * const { key } = await admin.keys.create(account.id, { name: "production" });
 */
export class AdminKeys {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Creates an API key for an account. The plaintext key is returned once; store it.
	 *
	 * @param accountId Account id.
	 * @param body Label for the key.
	 * @returns The key id, its display prefix and the plaintext key.
	 * @throws {NotFoundError} When the account does not exist (404).
	 * @example
	 * const created = await admin.keys.create(account.id, { name: "ci" });
	 */
	create(accountId: string, body: CreateApiKeyRequest): Promise<ApiKeyCreated> {
		return this.transport.json<ApiKeyCreated>({
			method: "POST",
			retry: "rateLimitOnly",
			path: `/admin/accounts/${encodeURIComponent(accountId)}/keys`,
			body
		});
	}

	/**
	 * Revokes an account API key. Requests with it fail with 401 from then on.
	 *
	 * @param accountId Account id.
	 * @param keyId Id of the key to revoke.
	 * @returns Resolves once the key is revoked (HTTP 204).
	 * @throws {NotFoundError} When the account or key does not exist (404).
	 * @example
	 * await admin.keys.revoke(account.id, created.id);
	 */
	revoke(accountId: string, keyId: string): Promise<void> {
		return this.transport.json<void>({
			method: "DELETE",
			retry: "idempotent",
			path: `/admin/accounts/${encodeURIComponent(accountId)}/keys/${encodeURIComponent(keyId)}`
		});
	}
}
