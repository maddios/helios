import { randomUUID } from "node:crypto";
import type { FileFromUrlRequest } from "@helios/contracts";
import type { Account, FileRecord } from "../models";
import { files } from "../models";
import { assertDestination } from "../destinations";
import { effectiveUploadPolicy } from "../policy";
import { fileKey, sanitizeFilename } from "./keys";
import { pendingExpiresAt } from "./pending";
import { enqueueFileIngest } from "./queues";

const DEFAULT_FILENAME = "download";

export async function createFileFromUrl(account: Account, input: FileFromUrlRequest): Promise<FileRecord> {
	if (input.destination !== undefined) {
		await assertDestination(input.destination);
	}
	const now = new Date();
	const fileId = randomUUID();
	const filename = sanitizeFilename(input.filename ?? filenameFromUrl(input.url));
	const record: FileRecord = {
		_id: fileId,
		accountId: account._id,
		key: fileKey(account.slug, fileId, filename),
		filename,
		status: "PENDING",
		source: "url",
		policy: effectiveUploadPolicy(account),
		sourceUrl: input.url,
		...(input.externalId !== undefined && { externalId: input.externalId }),
		...(input.destination !== undefined && { destination: input.destination }),
		expiresAt: pendingExpiresAt(now),
		createdAt: now
	};
	await files().insertOne(record);
	await enqueueFileIngest(fileId);
	return record;
}

function filenameFromUrl(url: string): string {
	return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? DEFAULT_FILENAME;
}
