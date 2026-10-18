import {
	ValidationError,
	type MultipartCompleteRequest,
	type MultipartCreateRequest,
	type MultipartCreateResponse
} from "@helios/contracts";
import { config } from "../config";
import { objectStore } from "../storage";
import { assertOwnedUploadKey, uploadKey } from "./keys";
import { assertWithinUploadLimit } from "./limits";

const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PART_SIZE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_PART_COUNT = 10000;

export function partSizeFor(sizeBytes: number): number {
	const partSizeBytes = Math.max(MIN_PART_SIZE_BYTES, Math.ceil(sizeBytes / MAX_PART_COUNT));
	if (partSizeBytes > MAX_PART_SIZE_BYTES) {
		throw new ValidationError("File is too large for a multipart upload", { sizeBytes });
	}
	return partSizeBytes;
}

export async function createMultipartUpload(
	slug: string,
	input: MultipartCreateRequest
): Promise<MultipartCreateResponse> {
	assertWithinUploadLimit(input.sizeBytes);
	const { UPLOAD_URL_EXPIRY_SEC } = config();
	const store = objectStore();
	const key = uploadKey(slug, input.filename);
	const uploadId = await store.createMultipartUpload(key, input.contentType);
	const partSizeBytes = partSizeFor(input.sizeBytes);
	const partCount = Math.ceil(input.sizeBytes / partSizeBytes);
	const parts = await Promise.all(
		Array.from({ length: partCount }, async (_, index) => {
			const partNumber = index + 1;
			return { partNumber, url: await store.presignPart(key, uploadId, partNumber, UPLOAD_URL_EXPIRY_SEC) };
		})
	);
	return { uploadId, uploadKey: key, partSizeBytes, parts };
}

export async function completeMultipartUpload(
	slug: string,
	input: Pick<MultipartCompleteRequest, "uploadKey" | "parts"> & { uploadId: string }
): Promise<string> {
	assertOwnedUploadKey(slug, input.uploadKey);
	const parts = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
	await objectStore().completeMultipartUpload(input.uploadKey, input.uploadId, parts);
	return input.uploadKey;
}

export async function abortMultipartUpload(
	slug: string,
	input: { uploadId: string; uploadKey: string }
): Promise<void> {
	assertOwnedUploadKey(slug, input.uploadKey);
	await objectStore().abortMultipartUpload(input.uploadKey, input.uploadId);
}
