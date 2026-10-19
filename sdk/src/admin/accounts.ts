import type { AccountCreated, AccountListResponse, AccountView, RotateWebhookSecretResponse } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";
import type { CreateAccountRequest, UpdateAccountRequest } from "../types.js";

/**
 * Creates, lists and updates accounts, and rotates their webhook secrets.
 *
 * @example
 * const { webhookSecret } = await admin.accounts.create({ slug: "bella", name: "Bella", sourceBuckets: ["bella-sources"] });
 */
export class AdminAccounts {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Lists every account.
	 *
	 * @returns All accounts, without webhook secrets.
	 * @example
	 * const { accounts } = await admin.accounts.list();
	 */
	list(): Promise<AccountListResponse> {
		return this.transport.json<AccountListResponse>({ method: "GET", retry: "idempotent", path: "/admin/accounts" });
	}

	/**
	 * Creates an account. The webhook secret is returned once, in this response; store it.
	 *
	 * @param body Slug, name, source buckets, feature flags and an optional destination.
	 * @returns The account and its one-time `webhookSecret`.
	 * @throws {ConflictError} When the slug is already taken (409).
	 * @throws {ValidationError} When the body is invalid (400).
	 * @example
	 * const account = await admin.accounts.create({ slug: "novel", name: "Novel", callbackUrl: "https://novel.example/hook" });
	 */
	create(body: CreateAccountRequest): Promise<AccountCreated> {
		return this.transport.json<AccountCreated>({
			method: "POST",
			retry: "rateLimitOnly",
			path: "/admin/accounts",
			body
		});
	}

	/**
	 * Updates an account's name, source buckets, features or destination.
	 *
	 * @param id Account id.
	 * @param body The fields to change.
	 * @returns The updated account.
	 * @throws {NotFoundError} When the account does not exist (404).
	 * @example
	 * await admin.accounts.update(account.id, { features: { peopleAttributes: true } });
	 */
	update(id: string, body: UpdateAccountRequest): Promise<AccountView> {
		return this.transport.json<AccountView>({
			method: "PATCH",
			retry: "rateLimitOnly",
			path: `/admin/accounts/${encodeURIComponent(id)}`,
			body
		});
	}

	/**
	 * Rotates an account's webhook secret. The previous secret stops verifying immediately.
	 *
	 * @param id Account id.
	 * @returns The new secret, shown once.
	 * @throws {NotFoundError} When the account does not exist (404).
	 * @example
	 * const { webhookSecret } = await admin.accounts.rotateWebhookSecret(account.id);
	 */
	rotateWebhookSecret(id: string): Promise<RotateWebhookSecretResponse> {
		return this.transport.json<RotateWebhookSecretResponse>({
			method: "POST",
			retry: "rateLimitOnly",
			path: `/admin/accounts/${encodeURIComponent(id)}/webhook-secret/rotate`
		});
	}
}
