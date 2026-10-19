import type { WebhookEvent } from "@helios/contracts";
import { getAccount } from "../accounts";
import type { Account, PipelineRequest } from "../models";
import { loadRequest, type CallbackMessage } from "../pipeline";
import { callbackEventId } from "./eventId";
import { itemEnvelope, requestEnvelope } from "./envelope";

export interface CallbackEvent {
	request: PipelineRequest;
	account: Account;
	envelope: WebhookEvent;
}

export async function buildCallbackEvent(message: CallbackMessage, now: Date): Promise<CallbackEvent> {
	const request = await loadRequest(message.requestId);
	const account = await getAccount(request.accountId);
	const id = callbackEventId(message);
	const createdAt = now.toISOString();
	const envelope =
		message.type === "item"
			? await itemEnvelope(id, createdAt, message.sequence, request, message.itemId)
			: await requestEnvelope(id, createdAt, message.sequence, request);
	return { request, account, envelope };
}
