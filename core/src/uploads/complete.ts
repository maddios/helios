import { ConflictError, UnprocessableError, ValidationError, type UploadParts } from "@helios/contracts";
import type { Account, FileRecord } from "../models";
import { objectStore } from "../storage";
import { loadFile, markFailed, markStored, releaseFileObjects, SNIFF_BYTES, sniffHead } from "../files";
import { storedViolationOf } from "../policy";

export async function completeUpload(
	account: Account,
	fileId: string,
	parts: UploadParts | undefined
): Promise<FileRecord> {
	const file = await loadFile(account._id, fileId);
	if (file.status === "STORED") {
		return file;
	}
	if (file.status === "FAILED") {
		throw new ConflictError(`File ${fileId} failed and cannot be completed`, { error: file.error }, "upload_failed");
	}
	if (file.uploadId === undefined && parts !== undefined) {
		throw new ValidationError("parts are only accepted for a multipart upload", { fileId });
	}
	const store = objectStore();
	let info = await store.objectInfo(file.key);
	if (info === undefined && file.uploadId !== undefined) {
		if (parts === undefined) {
			throw new ValidationError("parts are required to complete a multipart upload", { fileId });
		}
		const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
		await store.completeMultipartUpload(file.key, file.uploadId, sorted);
		info = await store.objectInfo(file.key);
	}
	if (info === undefined) {
		throw new UnprocessableError("Uploaded object does not exist", undefined, "source_not_found");
	}
	const head = info.size === 0 ? Buffer.alloc(0) : await store.readHead(file.key, SNIFF_BYTES);
	const sniffed = sniffHead(head);
	const reason = storedViolationOf(file.policy, {
		...(file.declaredContentType !== undefined && { declaredContentType: file.declaredContentType }),
		...(file.declaredSizeBytes !== undefined && { declaredSizeBytes: file.declaredSizeBytes }),
		filename: file.filename,
		candidates: sniffed.candidates,
		sizeBytes: info.size
	});
	if (reason !== undefined) {
		const claimed = await markFailed(file, reason);
		await releaseFileObjects(file);
		throw claimed ? new UnprocessableError(reason, undefined, "policy_violation") : changedDuringComplete(file);
	}
	const stored = await markStored(file, {
		contentType: sniffed.contentType,
		sizeBytes: info.size,
		...(sniffed.image !== undefined && { image: sniffed.image })
	});
	if (stored === undefined) {
		await releaseFileObjects(file);
		throw changedDuringComplete(file);
	}
	return stored;
}

/** The file was aborted, deleted or expired while it was being completed. Its objects are released by the caller. */
function changedDuringComplete(file: FileRecord): ConflictError {
	return new ConflictError(
		`File ${file._id} changed while it was being completed`,
		{ fileId: file._id },
		"complete_conflict"
	);
}
