import { callbackDeliveries, type CallbackDelivery } from "../models";

export async function listDeliveries(accountId: string, requestId: string): Promise<CallbackDelivery[]> {
	return callbackDeliveries().find({ accountId, requestId }).sort({ createdAt: 1 }).toArray();
}
