import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { db } from "../db";

export const CallbackDeliverySchema = z.object({
	_id: z.string(),
	requestId: z.string(),
	accountId: z.string(),
	event: z.string(),
	payload: z.unknown(),
	attempts: z.array(
		z.object({
			at: z.date(),
			status: z.enum(["DELIVERED", "FAILED"]),
			httpStatus: z.int().optional(),
			error: z.string().optional()
		})
	),
	deliveredAt: z.date().optional(),
	createdAt: z.date()
});
export type CallbackDelivery = z.infer<typeof CallbackDeliverySchema>;

export const callbackDeliveries = () => db().collection<CallbackDelivery>("callback_deliveries");

export const callbackDeliveryIndexes: IndexDescription[] = [{ key: { accountId: 1, requestId: 1, createdAt: 1 } }];
