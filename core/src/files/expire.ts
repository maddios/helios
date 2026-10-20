import { files, type FileRecord } from "../models";
import { contextLogger } from "../logger";
import { markFailed } from "./transitions";
import { releaseFileObjects } from "./release";
import { notifyFileEvent } from "./queues";

const EXPIRY_BATCH_SIZE = 100;
const EXPIRED_REASON = "Upload expired before it completed";

export async function expirePendingFiles(now: Date): Promise<void> {
	const expired = await files()
		.find({ status: "PENDING", expiresAt: { $lte: now }, deletedAt: { $exists: false } })
		.limit(EXPIRY_BATCH_SIZE)
		.toArray();
	for (const file of expired) {
		try {
			await expireFile(file);
		} catch (err) {
			contextLogger({}).error({ err, fileId: file._id }, "Expiring a pending file failed");
		}
	}
}

async function expireFile(file: FileRecord): Promise<void> {
	if (!(await markFailed(file, EXPIRED_REASON))) {
		return;
	}
	await releaseFileObjects(file);
	if (file.source === "url") {
		await notifyFileEvent(file._id, file.accountId, "file.failed");
	}
}
