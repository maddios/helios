import type { FileEventName } from "@helios/contracts";
import { queueFor } from "../queue";
import type { CallbackMessage } from "../pipeline";
import type { FileIngestMessage } from "./types";

export async function notifyFileEvent(fileId: string, accountId: string, event: FileEventName): Promise<void> {
	await queueFor<CallbackMessage>("callbacks.fifo").send({
		body: { type: "file", accountId, fileId, event, sequence: 1 },
		groupId: fileId,
		deduplicationId: `${fileId}:${event}`
	});
}

export async function enqueueFileIngest(fileId: string): Promise<void> {
	await queueFor<FileIngestMessage>("lambda-ai").send({ body: { fileId } });
}
