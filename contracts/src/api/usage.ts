import { z } from "zod";
import { ResourceUnitsSchema } from "../resourceUnits";
import { DateStringSchema } from "./common";

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

export const UsageQuerySchema = z
	.object({
		from: DateStringSchema.describe("Start date, inclusive"),
		to: DateStringSchema.describe("End date, inclusive")
	})
	.refine((query) => query.from <= query.to, { message: "from must not be after to", path: ["to"] })
	.refine((query) => (Date.parse(query.to) - Date.parse(query.from)) / DAY_MS <= MAX_RANGE_DAYS, {
		message: `the range must not exceed ${MAX_RANGE_DAYS} days`,
		path: ["to"]
	})
	.meta({ id: "UsageQuery" });
export type UsageQuery = z.infer<typeof UsageQuerySchema>;

export const UsageDaySchema = z.object({
	date: DateStringSchema.describe("Day the usage was recorded"),
	requests: z.int().describe("Number of requests on this day"),
	units: ResourceUnitsSchema.describe("Resource units consumed on this day")
});
export type UsageDay = z.infer<typeof UsageDaySchema>;

export const UsageResponseSchema = z
	.object({
		from: DateStringSchema.describe("Start date, inclusive"),
		to: DateStringSchema.describe("End date, inclusive"),
		requests: z.int().describe("Total number of requests in the range"),
		units: ResourceUnitsSchema.describe("Total resource units consumed in the range"),
		days: z.array(UsageDaySchema).describe("Usage broken down by day")
	})
	.meta({ id: "Usage" });
export type UsageResponse = z.infer<typeof UsageResponseSchema>;
