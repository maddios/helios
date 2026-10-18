import { z } from "zod";
import { CallbackUrlSchema } from "./common";

export const AccountFeaturesSchema = z.object({
	peopleAttributes: z.boolean().describe("Whether people attribute extraction is enabled")
});
export type AccountFeatures = z.infer<typeof AccountFeaturesSchema>;

export const AccountViewSchema = z
	.object({
		id: z.string().describe("Account id"),
		slug: z.string().describe("URL-safe account slug"),
		name: z.string().describe("Display name of the account"),
		sourceBuckets: z.array(z.string()).describe("Buckets the account may encode sources from"),
		callbackUrl: z.string().optional().describe("URL that receives request callbacks"),
		features: AccountFeaturesSchema.describe("Feature flags enabled for the account"),
		createdAt: z.iso.datetime().describe("When the account was created")
	})
	.meta({ id: "Account" });
export type AccountView = z.infer<typeof AccountViewSchema>;

export const CreateAccountRequestSchema = z
	.object({
		slug: z
			.string()
			.regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
			.describe("URL-safe account slug"),
		name: z.string().min(1).describe("Display name of the account"),
		sourceBuckets: z.array(z.string()).default([]).describe("Buckets the account may encode sources from"),
		callbackUrl: CallbackUrlSchema.optional().describe("URL that receives request callbacks"),
		features: AccountFeaturesSchema.partial()
			.default({ peopleAttributes: false })
			.describe("Feature flags to enable for the account")
	})
	.meta({ id: "CreateAccountRequest" });
export type CreateAccountRequest = z.infer<typeof CreateAccountRequestSchema>;

export const AccountCreatedSchema = AccountViewSchema.extend({
	webhookSecret: z.string().describe("Shown once; store it")
}).meta({ id: "AccountCreated" });
export type AccountCreated = z.infer<typeof AccountCreatedSchema>;

export const UpdateAccountRequestSchema = z
	.object({
		name: z.string().min(1).optional().describe("New display name"),
		sourceBuckets: z.array(z.string()).optional().describe("Buckets the account may encode sources from"),
		callbackUrl: CallbackUrlSchema.nullable()
			.optional()
			.describe("URL that receives request callbacks; null clears it"),
		features: AccountFeaturesSchema.partial().optional().describe("Feature flags to update")
	})
	.meta({ id: "UpdateAccountRequest" });
export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequestSchema>;

export const AccountListResponseSchema = z
	.object({
		accounts: z.array(AccountViewSchema).describe("All accounts")
	})
	.meta({ id: "AccountList" });
export type AccountListResponse = z.infer<typeof AccountListResponseSchema>;

export const RotateWebhookSecretResponseSchema = z
	.object({
		webhookSecret: z.string().describe("New secret, shown once")
	})
	.meta({ id: "RotateWebhookSecretResponse" });
export type RotateWebhookSecretResponse = z.infer<typeof RotateWebhookSecretResponseSchema>;
