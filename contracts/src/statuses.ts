import { z } from "zod";

export const ItemStatusSchema = z
	.enum(["BLOCKED", "QUEUED", "IN_PROGRESS", "COMPLETE", "SKIPPED", "ERROR", "CANCELLED"])
	.describe("Pipeline item status");
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

export const RequestStatusSchema = z
	.enum(["ANALYZING", "IN_PROGRESS", "COMPLETE", "ERROR", "CANCELLED"])
	.describe("Request status");
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const ItemKindSchema = z.enum(["encode", "transcribe", "scenes", "purge"]).describe("Pipeline item kind");
export type ItemKind = z.infer<typeof ItemKindSchema>;

export const OPTIONAL_ITEM_KINDS = ["transcribe", "scenes"] as const satisfies readonly ItemKind[];
export type OptionalItemKind = (typeof OPTIONAL_ITEM_KINDS)[number];

export function isOptionalKind(kind: ItemKind): kind is OptionalItemKind {
	return (OPTIONAL_ITEM_KINDS as readonly ItemKind[]).includes(kind);
}

export const RequestModeSchema = z
	.enum(["encode", "reencode", "postProcess", "purge"])
	.describe("Request mode describing what the request does");
export type RequestMode = z.infer<typeof RequestModeSchema>;

export const AnalyzeModeSchema = z.enum(["sync", "async"]).describe("Whether source analysis runs inline or queued");
export type AnalyzeMode = z.infer<typeof AnalyzeModeSchema>;
