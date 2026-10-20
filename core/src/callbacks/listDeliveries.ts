import { callbackDeliveries, type CallbackDelivery } from "../models";

export type RequestDelivery = CallbackDelivery & { requestId: string };

export async function listDeliveries(accountId: string, requestId: string): Promise<RequestDelivery[]> {
	const deliveries = await callbackDeliveries().find({ accountId, requestId }).sort({ createdAt: 1 }).toArray();
	return deliveries as RequestDelivery[];
}
