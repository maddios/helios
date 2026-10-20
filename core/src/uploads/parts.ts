import {
	ConflictError,
	ValidationError,
	type UploadPartsListResponse,
	type SignUploadPartsResponse
} from "@helios/contracts";
import { config } from "../config";
import type { Account, FileRecord } from "../models";
import { objectStore } from "../storage";
import { loadFile, releaseFileObjects, markFailed } from "../files";
import { expiresAtIso } from "./expiry";

export interface MultipartRecord extends FileRecord {
	uploadId: string;
	partCount: number;
}

export async function loadPendingMultipart(accountId: string, fileId: string): Promise<MultipartRecord> {
	const file = await loadFile(accountId, fileId);
	if (file.status !== "PENDING") {
		throw new ConflictError(`File ${fileId} is not pending`, { status: file.status }, "upload_not_pending");
	}
	if (file.uploadId === undefined || file.partCount === undefined) {
		throw new ValidationError(`File ${fileId} was not uploaded in parts`, { fileId });
	}
	return { ...file, uploadId: file.uploadId, partCount: file.partCount };
}

export async function signUploadParts(
	account: Account,
	fileId: string,
	partNumbers: number[]
): Promise<SignUploadPartsResponse> {
	const file = await loadPendingMultipart(account._id, fileId);
	const beyond = partNumbers.find((partNumber) => partNumber > file.partCount);
	if (beyond !== undefined) {
		throw new ValidationError(`Part ${beyond} is beyond the ${file.partCount} parts of this upload`, { fileId });
	}
	const { UPLOAD_URL_EXPIRY_SEC } = config();
	const store = objectStore();
	const parts = await Promise.all(
		partNumbers.map(async (partNumber) => ({
			partNumber,
			url: await store.presignPart(file.key, file.uploadId, partNumber, UPLOAD_URL_EXPIRY_SEC)
		}))
	);
	return { parts, expiresAt: expiresAtIso(UPLOAD_URL_EXPIRY_SEC) };
}

export async function listUploadParts(accountId: string, fileId: string): Promise<UploadPartsListResponse> {
	const file = await loadPendingMultipart(accountId, fileId);
	return { parts: await objectStore().listParts(file.key, file.uploadId) };
}

export async function abortUpload(accountId: string, fileId: string): Promise<void> {
	const file = await loadFile(accountId, fileId);
	if (!(await markFailed(file, "Upload was aborted"))) {
		throw new ConflictError(`File ${fileId} is not pending`, { status: file.status }, "upload_not_pending");
	}
	await releaseFileObjects(file);
}
