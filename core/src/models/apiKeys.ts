import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { db } from "../db";

export const ApiKeySchema = z
	.object({
		_id: z.string(),
		scope: z.enum(["account", "admin"]),
		accountId: z.string().optional(),
		name: z.string(),
		hash: z.string(),
		prefix: z.string(),
		lastUsedAt: z.date().optional(),
		revokedAt: z.date().optional(),
		createdAt: z.date()
	})
	.refine((key) => key.scope === "admin" || key.accountId !== undefined, {
		message: "Account keys require an accountId"
	});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const apiKeys = () => db().collection<ApiKey>("api_keys");

export const apiKeyIndexes: IndexDescription[] = [
	{ key: { hash: 1 }, unique: true },
	{ key: { accountId: 1 } },
	{ key: { scope: 1 } }
];
