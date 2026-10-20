import { queueFor } from "../queue";
import { nextSequence } from "./nextSequence";
import type { CallbackDraft, RequestCallbackMessage, CallbackMessage } from "./types";

export async function sendCallback(draft: CallbackDraft, deduplicationId: string): Promise<void> {
	const body: RequestCallbackMessage = { ...draft, sequence: await nextSequence(draft.requestId) };
	await queueFor<CallbackMessage>("callbacks.fifo").send({ body, groupId: body.requestId, deduplicationId });
}
