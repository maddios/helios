import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { DestinationSchema, UploadPolicySchema } from "@helios/contracts";
import { db } from "../db";

export const AccountSchema = z.object({
	_id: z.string(),
	slug: z.string(),
	name: z.string(),
	sourceBuckets: z.array(z.string()),
	destination: DestinationSchema.optional(),
	webhookSecret: z.string(),
	lastDestinationTestAt: z.date().optional(),
	features: z.object({
		peopleAttributes: z.boolean()
	}),
	uploadPolicy: UploadPolicySchema.optional(),
	createdAt: z.date()
});
export type Account = z.infer<typeof AccountSchema>;

export const accounts = () => db().collection<Account>("accounts");

export const accountIndexes: IndexDescription[] = [{ key: { slug: 1 }, unique: true }];
