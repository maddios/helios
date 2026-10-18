import { z } from "zod";

export const DateStringSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.describe("Calendar date in YYYY-MM-DD format");
export type DateString = z.infer<typeof DateStringSchema>;

export const CallbackUrlSchema = z
	.url()
	.refine((value) => /^https?:\/\//i.test(value), "callbackUrl must use http or https")
	.describe("URL that receives callbacks; http or https only");

export const PaginationQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).optional().describe("Maximum number of items to return"),
	cursor: z.string().optional().describe("Opaque cursor returned by the previous page")
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
