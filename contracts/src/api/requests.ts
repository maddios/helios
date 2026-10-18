import { z } from "zod";
import { ResolvedPostProcessSchema } from "../postProcess";
import { ItemQueueNameSchema } from "../queues";
import { ItemKindSchema, ItemStatusSchema, RequestModeSchema, RequestStatusSchema } from "../statuses";

export const RequestErrorSchema = z
	.object({
		code: z.string().describe("Machine-readable error code"),
		message: z.string().describe("Human-readable error message")
	})
	.meta({ id: "RequestError" });
export type RequestError = z.infer<typeof RequestErrorSchema>;

export const RequestItemViewSchema = z
	.object({
		id: z.string().describe("Item id"),
		key: z.string().describe("Item key, unique within the request"),
		kind: ItemKindSchema.describe("Pipeline item kind"),
		profile: z.string().optional().describe("Profile the item encodes with"),
		queue: ItemQueueNameSchema.describe("Queue the item is dispatched to"),
		priority: z.int().describe("Dispatch priority; higher runs first"),
		status: ItemStatusSchema.describe("Current item status"),
		error: z.string().optional().describe("Error message when the item failed"),
		completedAt: z.iso.datetime().optional().describe("When the item reached a terminal status")
	})
	.meta({ id: "RequestItem" });
export type RequestItemView = z.infer<typeof RequestItemViewSchema>;

export const RequestProgressSchema = z
	.object({
		total: z.int().describe("Total number of items in the request"),
		finished: z.int().describe("Items in a terminal status"),
		pending: z.int().describe("Items not yet dispatched or still running")
	})
	.meta({ id: "RequestProgress" });
export type RequestProgress = z.infer<typeof RequestProgressSchema>;

export const RequestViewSchema = z
	.object({
		id: z.string().describe("Request id"),
		assetId: z.string().describe("Id of the asset the request operates on"),
		mode: RequestModeSchema.describe("What the request does"),
		status: RequestStatusSchema.describe("Current request status"),
		clientRequestId: z.string().optional().describe("Client idempotency key supplied at creation"),
		postProcess: ResolvedPostProcessSchema.optional().describe(
			"Post-processing options in effect; absent for purge requests"
		),
		assetVersion: z.int().describe("Asset version the request produces"),
		items: z.array(RequestItemViewSchema).describe("Pipeline items of the request"),
		progress: RequestProgressSchema.describe("Item progress counts"),
		error: RequestErrorSchema.optional().describe("Error that failed the request"),
		createdAt: z.iso.datetime().describe("When the request was created"),
		completedAt: z.iso.datetime().optional().describe("When the request reached a terminal status")
	})
	.meta({ id: "Request" });
export type RequestView = z.infer<typeof RequestViewSchema>;
