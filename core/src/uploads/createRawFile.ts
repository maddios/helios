import { cdnUrl } from "../cdn";
import { config } from "../config";
import { objectStore } from "../storage";
import type { FileUploadRequest, FileUploadResponse } from "@helios/contracts";
import { expiresAtIso } from "./expiry";
import { rawFileKey } from "./keys";

export async function createRawFileUpload(slug: string, input: FileUploadRequest): Promise<FileUploadResponse> {
	const { UPLOAD_URL_EXPIRY_SEC } = config();
	const fileKey = rawFileKey(slug, input.filename);
	const uploadUrl = await objectStore().presignPut(fileKey, UPLOAD_URL_EXPIRY_SEC, input.contentType);
	return { fileKey, uploadUrl, url: cdnUrl(fileKey), expiresAt: expiresAtIso(UPLOAD_URL_EXPIRY_SEC) };
}
