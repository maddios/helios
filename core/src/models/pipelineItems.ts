import { z } from "zod";
import type { IndexDescription } from "mongodb";
import {
	ActiveStillSchema,
	ItemKindSchema,
	ItemStatusSchema,
	MediaAssetOutputSchema,
	QueueNameSchema,
	UsageSchema
} from "@helios/contracts";
import { db } from "../db";

export const PIPELINE_ITEM_TTL_SEC = 30 * 24 * 60 * 60;

export const ItemOutputSchema = z.object({
	assetOutputs: z.record(z.string(), MediaAssetOutputSchema).optional(),
	activeStill: ActiveStillSchema.optional()
});
export type ItemOutput = z.infer<typeof ItemOutputSchema>;

export const PipelineItemSchema = z.object({
	_id: z.string(),
	requestId: z.string(),
	assetId: z.string(),
	accountId: z.string(),
	kind: ItemKindSchema,
	profile: z.string().optional(),
	queue: QueueNameSchema,
	priority: z.int(),
	messageId: z.string().optional(),
	leaseId: z.string().optional(),
	heartbeatAt: z.date().optional(),
	status: ItemStatusSchema,
	pendingDeps: z.array(z.string()),
	requiredDeps: z.array(z.string()),
	dependents: z.array(z.string()),
	attempts: z.int(),
	progress: z.number().min(0).max(100),
	error: z.string().optional(),
	output: ItemOutputSchema.optional(),
	usage: z.array(UsageSchema),
	startedAt: z.date().optional(),
	completedAt: z.date().optional(),
	createdAt: z.date()
});
export type PipelineItem = z.infer<typeof PipelineItemSchema>;

export const pipelineItems = () => db().collection<PipelineItem>("pipeline_items");

export const pipelineItemIndexes: IndexDescription[] = [
	{ key: { requestId: 1 } },
	{ key: { assetId: 1, status: 1 } },
	{ key: { completedAt: 1 }, expireAfterSeconds: PIPELINE_ITEM_TTL_SEC }
];
