import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { ItemKindSchema, ItemStatusSchema, RequestStatusSchema, UsageSchema } from "@helios/contracts";
import { db } from "../db";

export const JobReportSchema = z.object({
	_id: z.string(),
	requestId: z.string(),
	accountId: z.string(),
	assetId: z.string(),
	status: RequestStatusSchema,
	items: z.array(
		z.object({
			itemId: z.string(),
			kind: ItemKindSchema,
			profile: z.string().optional(),
			status: ItemStatusSchema,
			usage: UsageSchema.optional(),
			error: z.string().optional()
		})
	),
	usage: UsageSchema,
	createdAt: z.date()
});
export type JobReport = z.infer<typeof JobReportSchema>;

export const jobReports = () => db().collection<JobReport>("job_reports");

export const jobReportIndexes: IndexDescription[] = [
	{ key: { requestId: 1 }, unique: true },
	{ key: { accountId: 1, createdAt: -1 } }
];
