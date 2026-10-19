import { contextLogger } from "../logger";
import type { CallbackMessage } from "../pipeline";
import { callbackDeliveries } from "../models";
import { settleDelivery } from "./delivery";
import { callbackEventId } from "./eventId";

export async function markDeliveryFailed(message: CallbackMessage): Promise<void> {
	const id = callbackEventId(message);
	if ((await callbackDeliveries().findOne({ _id: id })) === null) {
		contextLogger({ requestId: message.requestId }).error(
			"Dead-letter delivery not found; acknowledged without action"
		);
		return;
	}
	await settleDelivery(id, "FAILED");
}
