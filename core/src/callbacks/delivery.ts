import type { WebhookEvent } from "@helios/contracts";
import { callbackDeliveries, type CallbackDelivery } from "../models";

type Attempt = CallbackDelivery["attempts"][number];
type DestinationType = CallbackDelivery["destinationType"];

export async function openDelivery(
	id: string,
	event: WebhookEvent,
	requestId: string,
	accountId: string,
	destinationType: DestinationType,
	now: Date
): Promise<void> {
	await callbackDeliveries().updateOne(
		{ _id: id },
		{
			$setOnInsert: {
				requestId,
				accountId,
				event: event.event,
				status: "PENDING",
				attempts: [],
				createdAt: now
			},
			$set: { payload: event, ...(destinationType !== undefined && { destinationType }) }
		},
		{ upsert: true }
	);
}

export async function recordAttempt(id: string, attempt: Attempt): Promise<void> {
	await callbackDeliveries().updateOne(
		{ _id: id },
		{
			$push: { attempts: attempt },
			...(attempt.status === "DELIVERED" && { $set: { status: "DELIVERED", deliveredAt: attempt.at } })
		}
	);
}

export async function settleDelivery(id: string, status: "SKIPPED" | "FAILED"): Promise<void> {
	await callbackDeliveries().updateOne({ _id: id, status: "PENDING" }, { $set: { status } });
}
