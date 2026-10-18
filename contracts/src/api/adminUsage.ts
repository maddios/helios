import { z } from "zod";
import { ResourceUnitsSchema } from "../resourceUnits";
import { DateStringSchema } from "./common";

export const AdminUsageAccountSchema = z.object({
	accountId: z.string().describe("Id of the account"),
	requests: z.int().describe("Number of requests in the range"),
	units: ResourceUnitsSchema.describe("Resource units consumed in the range")
});
export type AdminUsageAccount = z.infer<typeof AdminUsageAccountSchema>;

export const AdminUsageResponseSchema = z
	.object({
		from: DateStringSchema.describe("Start date, inclusive"),
		to: DateStringSchema.describe("End date, inclusive"),
		accounts: z.array(AdminUsageAccountSchema).describe("Usage broken down by account")
	})
	.meta({ id: "AdminUsage" });
export type AdminUsageResponse = z.infer<typeof AdminUsageResponseSchema>;
