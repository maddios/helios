import { z } from "zod";
import {
	AccountCreatedSchema,
	AccountListResponseSchema,
	AccountViewSchema,
	ApiKeyCreatedSchema,
	CreateAccountRequestSchema,
	CreateApiKeyRequestSchema,
	RotateWebhookSecretResponseSchema,
	UpdateAccountRequestSchema
} from "@helios/contracts";
import {
	createAccount,
	createApiKey,
	getAccount,
	listAccounts,
	revokeApiKey,
	rotateWebhookSecret,
	updateAccount
} from "@helios/core";
import { endpoint } from "../../http/endpoint";
import { reply } from "../../http/reply";
import { toAccountView } from "../../views/account";
import { toApiKeyCreatedView } from "../../views/apiKey";
import { IdParams } from "../params";

const KeyParams = IdParams.extend({ keyId: z.string().min(1).describe("API key id") });

export const adminAccountRoutes = [
	endpoint({
		method: "post",
		path: "/admin/accounts",
		summary: "Create an account; returns its webhook secret once",
		auth: "admin",
		input: { body: CreateAccountRequestSchema },
		responses: { 201: { description: "Created account", schema: AccountCreatedSchema } },
		errors: [409, 422],
		handle: async ({ input }) => {
			const account = await createAccount(input.body);
			return reply.created({ ...toAccountView(account), webhookSecret: account.webhookSecret });
		}
	}),
	endpoint({
		method: "get",
		path: "/admin/accounts",
		summary: "List accounts",
		auth: "admin",
		responses: { 200: { description: "Accounts", schema: AccountListResponseSchema } },
		handle: async () => reply.ok({ accounts: (await listAccounts()).map(toAccountView) })
	}),
	endpoint({
		method: "patch",
		path: "/admin/accounts/{id}",
		summary: "Update an account",
		auth: "admin",
		input: { params: IdParams, body: UpdateAccountRequestSchema },
		responses: { 200: { description: "Updated account", schema: AccountViewSchema } },
		errors: [404, 422],
		handle: async ({ input }) => reply.ok(toAccountView(await updateAccount(input.params.id, input.body)))
	}),
	endpoint({
		method: "post",
		path: "/admin/accounts/{id}/keys",
		summary: "Create an account API key; the plaintext key is returned once",
		auth: "admin",
		input: { params: IdParams, body: CreateApiKeyRequestSchema },
		responses: { 201: { description: "Created key", schema: ApiKeyCreatedSchema } },
		errors: [404],
		handle: async ({ input }) => {
			await getAccount(input.params.id);
			const { key, record } = await createApiKey({
				scope: "account",
				accountId: input.params.id,
				name: input.body.name
			});
			return reply.created(toApiKeyCreatedView(key, record));
		}
	}),
	endpoint({
		method: "delete",
		path: "/admin/accounts/{id}/keys/{keyId}",
		summary: "Revoke an account API key",
		auth: "admin",
		input: { params: KeyParams },
		responses: { 204: { description: "Key revoked" } },
		errors: [404],
		handle: async ({ input }) => {
			await revokeApiKey(input.params.id, input.params.keyId);
			return reply.noContent();
		}
	}),
	endpoint({
		method: "post",
		path: "/admin/accounts/{id}/webhook-secret/rotate",
		summary: "Rotate the account webhook secret; the new secret is returned once",
		auth: "admin",
		input: { params: IdParams },
		responses: { 200: { description: "New secret", schema: RotateWebhookSecretResponseSchema } },
		errors: [404],
		handle: async ({ input }) => reply.ok({ webhookSecret: await rotateWebhookSecret(input.params.id) })
	})
];
