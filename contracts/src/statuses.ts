import { z } from "zod";

export const ItemStatusSchema = z
	.enum(["BLOCKED", "QUEUED", "IN_PROGRESS", "COMPLETE", "SKIPPED", "ERROR", "CANCELLED"])
	.describe("Pipeline item status");
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

export const RequestStatusSchema = z.enum(["IN_PROGRESS", "COMPLETE", "ERROR", "CANCELLED"]).describe("Request status");
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const ItemKindSchema = z.enum(["encode", "transcribe", "scenes", "purge"]).describe("Pipeline item kind");
export type ItemKind = z.infer<typeof ItemKindSchema>;

export const RequestModeSchema = z
	.enum(["encode", "reencode", "postProcess"])
	.describe("Request mode describing what the request does");
export type RequestMode = z.infer<typeof RequestModeSchema>;
