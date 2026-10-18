import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { PresetSchema, RequestModeSchema, RequestStatusSchema, ResolvedPostProcessSchema } from "@helios/contracts";
import { db } from "../db";

export const RequestSchema = z.object({
	_id: z.string(),
	accountId: z.string(),
	assetId: z.string(),
	clientRequestId: z.string(),
	mode: RequestModeSchema,
	presetSnapshot: PresetSchema,
	postProcess: ResolvedPostProcessSchema,
	assetVersion: z.int().min(1),
	pendingItems: z.array(z.string()),
	status: RequestStatusSchema,
	callbackUrl: z.string().optional(),
	completedAt: z.date().optional(),
	enqueuedAt: z.date().optional(),
	createdAt: z.date()
});
export type PipelineRequest = z.infer<typeof RequestSchema>;

export const requests = () => db().collection<PipelineRequest>("requests");

export const requestIndexes: IndexDescription[] = [
	{ key: { accountId: 1, clientRequestId: 1 }, unique: true },
	{ key: { accountId: 1, assetId: 1 } },
	{ key: { accountId: 1, createdAt: -1 } },
	{ key: { enqueuedAt: 1, createdAt: 1 }, partialFilterExpression: { status: "IN_PROGRESS" } }
];
