import type { CallbackMessage } from "../pipeline";
import { buildCallbackEvent } from "./buildCallbackEvent";
import { openDelivery, recordAttempt, settleDelivery } from "./delivery";
import { backoffSec, CallbackDeliveryError, PayloadTooLargeError } from "./errors";
import { assertPayloadSize } from "./payloadSize";
import { resolveDestination } from "./resolveDestination";
import { sendTo } from "./senders";

export async function deliverCallback(message: CallbackMessage, receiveCount: number): Promise<void> {
	const now = new Date();
	const { request, account, envelope } = await buildCallbackEvent(message, now);
	const destination = resolveDestination(request, account);
	await openDelivery(envelope.id, envelope, request._id, request.accountId, destination?.type, now);
	if (destination === undefined) {
		await settleDelivery(envelope.id, "SKIPPED");
		return;
	}
	try {
		assertPayloadSize(envelope);
	} catch (err) {
		if (!(err instanceof PayloadTooLargeError)) {
			throw err;
		}
		await recordAttempt(envelope.id, { at: now, status: "FAILED", error: err.message });
		await settleDelivery(envelope.id, "FAILED");
		return;
	}
	const outcome = await sendTo(destination, envelope, account, now);
	await recordAttempt(envelope.id, { at: now, ...outcome });
	if (outcome.status === "FAILED") {
		throw new CallbackDeliveryError(outcome.error, backoffSec(receiveCount));
	}
}
