import { queueFor } from "../queue";
import type { CallbackMessage } from "./types";

export function sendCallback(body: CallbackMessage, deduplicationId: string): Promise<void> {
	return queueFor<CallbackMessage>("callbacks.fifo").send({ body, groupId: body.requestId, deduplicationId });
}
