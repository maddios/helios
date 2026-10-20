import type { WebhookEvent } from "@helios/contracts";
import { getAccount } from "../accounts";
import type { Account, PipelineRequest } from "../models";
import { loadRequest, type CallbackMessage } from "../pipeline";
import { loadFileRecord } from "../files";
import type { Destination } from "@helios/contracts";
import { callbackEventId } from "./eventId";
import { fileEnvelope, itemEnvelope, requestEnvelope } from "./envelope";
import type { DeliverySubject } from "./delivery";
import { resolveDestination } from "./resolveDestination";

export interface CallbackEvent {
	envelope: WebhookEvent;
	account: Account;
	destination: Destination | undefined;
	subject: DeliverySubject;
}

export async function buildCallbackEvent(message: CallbackMessage, now: Date): Promise<CallbackEvent> {
	const id = callbackEventId(message);
	const createdAt = now.toISOString();
	if (message.type === "file") {
		const account = await getAccount(message.accountId);
		const envelope = await fileEnvelope(id, createdAt, message, message.fileId);
		const file = await loadFileRecord(message.fileId);
		return {
			envelope,
			account,
			destination: file?.destination ?? account.destination,
			subject: { fileId: message.fileId }
		};
	}
	const request: PipelineRequest = await loadRequest(message.requestId);
	const account = await getAccount(request.accountId);
	const envelope =
		message.type === "item"
			? await itemEnvelope(id, createdAt, message.sequence, request, message.itemId)
			: await requestEnvelope(id, createdAt, message.sequence, request);
	return {
		envelope,
		account,
		destination: resolveDestination(request, account),
		subject: { requestId: request._id }
	};
}
