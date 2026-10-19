import type { IndexDescription } from "mongodb";
import { z } from "zod";
import { db } from "../db";

export const CdnInvalidationSchema = z.object({
	_id: z.string(),
	paths: z.array(z.string()),
	status: z.enum(["PENDING", "SENT", "FAILED"]),
	attempts: z.number().int().nonnegative(),
	createdAt: z.date(),
	sentAt: z.date().optional()
});
export type CdnInvalidation = z.infer<typeof CdnInvalidationSchema>;

export const cdnInvalidationIndexes: IndexDescription[] = [{ key: { status: 1, createdAt: 1 } }];

export const cdnInvalidations = () => db().collection<CdnInvalidation>("cdn_invalidations");
