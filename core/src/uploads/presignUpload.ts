import type { PresignedUploadRequest, PresignedUploadResponse } from "@helios/contracts";
import { config } from "../config";
import { objectStore } from "../storage";
import { expiresAtIso } from "./expiry";
import { uploadKey } from "./keys";
import { assertWithinUploadLimit } from "./limits";

export async function createPresignedUpload(
	slug: string,
	input: PresignedUploadRequest
): Promise<PresignedUploadResponse> {
	assertWithinUploadLimit(input.sizeBytes);
	const { UPLOAD_URL_EXPIRY_SEC } = config();
	const key = uploadKey(slug, input.filename);
	const url = await objectStore().presignPut(key, UPLOAD_URL_EXPIRY_SEC, input.contentType);
	return { uploadKey: key, url, expiresAt: expiresAtIso(UPLOAD_URL_EXPIRY_SEC) };
}
