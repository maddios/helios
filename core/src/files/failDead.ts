import { files } from "../models";
import { releaseFileObjects } from "./release";
import { notifyFileEvent } from "./queues";
import { markFailed } from "./transitions";

const INGEST_DEAD_REASON = "File ingest failed after repeated attempts";

/** Settles a from-url file whose ingest message reached a dead-letter queue. Idempotent. */
export async function failDeadFile(fileId: string): Promise<void> {
	const file = await files().findOne({ _id: fileId });
	if (file === null || !(await markFailed(file, INGEST_DEAD_REASON))) {
		return;
	}
	await releaseFileObjects(file);
	await notifyFileEvent(fileId, file.accountId, "file.failed");
}
