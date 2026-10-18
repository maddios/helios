import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { db } from "../db";

export const AccountSchema = z.object({
	_id: z.string(),
	slug: z.string(),
	name: z.string(),
	sourceBuckets: z.array(z.string()),
	callbackUrl: z.string().optional(),
	webhookSecret: z.string(),
	features: z.object({
		peopleAttributes: z.boolean()
	}),
	createdAt: z.date()
});
export type Account = z.infer<typeof AccountSchema>;

export const accounts = () => db().collection<Account>("accounts");

export const accountIndexes: IndexDescription[] = [{ key: { slug: 1 }, unique: true }];
