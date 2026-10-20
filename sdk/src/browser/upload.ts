import { uploadParts } from "./uploadParts.js";
import { uploadSingle } from "./uploadSingle.js";
import type { BrowserUpload, BrowserUploadResult, UploadPartsOptions } from "./types.js";

/**
 * Uploads a file to the upload the backend created, choosing a single PUT or multipart from its `mode`.
 *
 * @param created The result of `uploads.create`, passed from the backend. Its `fileId` is what the backend completes.
 * @param file The file to upload.
 * @param options Progress, cancellation and, for multipart uploads, concurrency, URL renewal, resume and retries.
 * @returns The uploaded parts for a multipart upload, to pass to `uploads.complete`; nothing for a single PUT.
 * @throws {BrowserUploadError} With the codes of {@link uploadParts} or {@link uploadSingle}.
 * @example
 * const created = await fetch("/api/uploads", { method: "POST", body: JSON.stringify(meta) }).then((r) => r.json());
 * const { parts } = await upload(created, file, { onProgress: ({ uploadedBytes, totalBytes }) => bar(uploadedBytes / totalBytes) });
 */
export async function upload(
	created: BrowserUpload,
	file: Blob,
	options: UploadPartsOptions = {}
): Promise<BrowserUploadResult> {
	if (created.mode === "single") {
		await uploadSingle(created, file, options);
		return {};
	}
	return { parts: await uploadParts(created, file, options) };
}
