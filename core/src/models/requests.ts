import { z } from "zod";
import type { IndexDescription } from "mongodb";
import {
	AnalyzeModeSchema,
	PresetSchema,
	RequestErrorSchema,
	RequestModeSchema,
	RequestStatusSchema,
	ResolvedPostProcessSchema
} from "@helios/contracts";
import { db } from "../db";

const RequestBaseSchema = z.object({
	_id: z.string(),
	accountId: z.string(),
	assetId: z.string(),
	clientRequestId: z.string(),
	mode: RequestModeSchema,
	analyze: AnalyzeModeSchema,
	presetSnapshot: PresetSchema.optional(),
	postProcess: ResolvedPostProcessSchema.optional(),
	assetVersion: z.int().min(1),
	pendingItems: z.array(z.string()),
	status: RequestStatusSchema,
	error: RequestErrorSchema.optional(),
	callbackUrl: z.string().optional(),
	completedAt: z.date().optional(),
	enqueuedAt: z.date().optional(),
	createdAt: z.date()
});

export const RequestSchema = RequestBaseSchema.superRefine((request, ctx) => {
	if (request.mode === "purge") {
		return;
	}
	for (const path of ["presetSnapshot", "postProcess"] as const) {
		if (request[path] === undefined) {
			ctx.addIssue({ code: "custom", path: [path], message: `${path} is required unless mode is purge` });
		}
	}
});
export type PipelineRequest = z.infer<typeof RequestSchema>;

export const requests = () => db().collection<PipelineRequest>("requests");

export const requestIndexes: IndexDescription[] = [
	{ key: { accountId: 1, clientRequestId: 1 }, unique: true },
	{ key: { accountId: 1, assetId: 1 } },
	{ key: { accountId: 1, createdAt: -1 } },
	{ key: { enqueuedAt: 1, createdAt: 1 }, partialFilterExpression: { status: "IN_PROGRESS" } },
	{ key: { status: 1, createdAt: 1 }, partialFilterExpression: { status: "ANALYZING" } }
];
