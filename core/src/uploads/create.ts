import { randomUUID } from "node:crypto";
import type { CreateUploadRequest, CreateUploadResponse } from "@helios/contracts";
import { config } from "../config";
import { files, type Account, type FileRecord } from "../models";
import { objectStore } from "../storage";
import { fileKey, sanitizeFilename, pendingExpiresAt } from "../files";
import { contentDispositionFor } from "../policy";
import { expiresAtIso } from "./expiry";
import { assertWithinUploadLimit } from "./limits";
import { partCountFor, partSizeFor } from "./multipart";
import { assertWithinPolicy, resolveUploadPolicy } from "../policy";

export async function createUpload(account: Account, input: CreateUploadRequest): Promise<CreateUploadResponse> {
	assertWithinUploadLimit(input.sizeBytes);
	const policy = resolveUploadPolicy(account, input.policy);
	assertWithinPolicy(policy, { candidates: [input.contentType], sizeBytes: input.sizeBytes });
	const { UPLOAD_URL_EXPIRY_SEC, UPLOAD_MULTIPART_THRESHOLD_BYTES } = config();
	const now = new Date();
	const fileId = randomUUID();
	const key = fileKey(account.slug, fileId, input.filename);
	const record: FileRecord = {
		_id: fileId,
		accountId: account._id,
		key,
		filename: sanitizeFilename(input.filename),
		status: "PENDING",
		source: "upload",
		policy,
		declaredContentType: input.contentType,
		declaredSizeBytes: input.sizeBytes,
		...(input.externalId !== undefined && { externalId: input.externalId }),
		expiresAt: pendingExpiresAt(now),
		createdAt: now
	};
	const store = objectStore();
	const expiresAt = expiresAtIso(UPLOAD_URL_EXPIRY_SEC);
	const write = { contentType: input.contentType, contentDisposition: contentDispositionFor(input.contentType) };
	if (input.sizeBytes <= UPLOAD_MULTIPART_THRESHOLD_BYTES) {
		const url = await store.presignPut(key, UPLOAD_URL_EXPIRY_SEC, { ...write, contentLength: input.sizeBytes });
		await files().insertOne(record);
		return { mode: "single", fileId, key, url, headers: headersOf(write), expiresAt };
	}
	const partSizeBytes = partSizeFor(input.sizeBytes);
	const partCount = partCountFor(input.sizeBytes, partSizeBytes);
	const uploadId = await store.createMultipartUpload(key, write);
	const parts = await Promise.all(
		Array.from({ length: partCount }, async (_, index) => {
			const partNumber = index + 1;
			return { partNumber, url: await store.presignPart(key, uploadId, partNumber, UPLOAD_URL_EXPIRY_SEC) };
		})
	);
	await files().insertOne({ ...record, uploadId, partCount });
	return { mode: "multipart", fileId, key, uploadId, partSizeBytes, parts, expiresAt };
}

function headersOf(write: { contentType: string; contentDisposition: string }): Record<string, string> {
	return { "Content-Type": write.contentType, "Content-Disposition": write.contentDisposition };
}
