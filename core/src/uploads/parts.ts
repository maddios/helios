import type { MultipartListPartsResponse, MultipartSignPartsResponse } from "@helios/contracts";
import { config } from "../config";
import { objectStore } from "../storage";
import { expiresAtIso } from "./expiry";
import { assertOwnedUploadKey } from "./keys";

export async function signMultipartParts(
	slug: string,
	input: { uploadId: string; uploadKey: string; partNumbers: number[] }
): Promise<MultipartSignPartsResponse> {
	assertOwnedUploadKey(slug, input.uploadKey);
	const { UPLOAD_URL_EXPIRY_SEC } = config();
	const store = objectStore();
	const parts = await Promise.all(
		input.partNumbers.map(async (partNumber) => ({
			partNumber,
			url: await store.presignPart(input.uploadKey, input.uploadId, partNumber, UPLOAD_URL_EXPIRY_SEC)
		}))
	);
	return { parts, expiresAt: expiresAtIso(UPLOAD_URL_EXPIRY_SEC) };
}

export async function listMultipartParts(
	slug: string,
	input: { uploadId: string; uploadKey: string }
): Promise<MultipartListPartsResponse> {
	assertOwnedUploadKey(slug, input.uploadKey);
	return { parts: await objectStore().listParts(input.uploadKey, input.uploadId) };
}
