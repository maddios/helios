import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { ResourceUnitsSchema } from "@helios/contracts";
import { db } from "../db";

export const UsageDailySchema = z.object({
	_id: z.string(),
	accountId: z.string(),
	date: z.string(),
	requests: z.int(),
	units: ResourceUnitsSchema
});
export type UsageDaily = z.infer<typeof UsageDailySchema>;

export const usageDaily = () => db().collection<UsageDaily>("usage_daily");

export const usageDailyIndexes: IndexDescription[] = [{ key: { accountId: 1, date: -1 } }];
