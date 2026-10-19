import { BrowserUploadError } from "./errors.js";
import { putBlob } from "./xhr.js";
import type { PresignedUpload, UploadSingleOptions } from "./types.js";

/**
 * Uploads a file with one presigned PUT, from the browser, for files small enough for `uploads.presign`.
 *
 * @param presigned The presigned URL and any headers the signature covers.
 * @param file The file to upload.
 * @param options Progress and cancellation.
 * @returns Resolves once storage accepts the file.
 * @throws {BrowserUploadError} With code `upload_failed` when storage rejects the file, with its HTTP status.
 * @throws {BrowserUploadError} With code `aborted` when the signal fires.
 * @example
 * const { url } = await fetch("/api/uploads/presign", { method: "POST" }).then((r) => r.json());
 * await uploadSingle({ url, headers: { "content-type": file.type } }, file);
 */
export async function uploadSingle(
	presigned: PresignedUpload,
	file: Blob,
	options: UploadSingleOptions = {}
): Promise<void> {
	const response = await putBlob({
		url: presigned.url,
		body: file,
		headers: presigned.headers ?? {},
		onUploadProgress: (loadedBytes) => options.onProgress?.({ uploadedBytes: loadedBytes, totalBytes: file.size }),
		signal: options.signal
	});
	if (response.status < 200 || response.status >= 300) {
		throw new BrowserUploadError("upload_failed", `Storage rejected the upload with status ${response.status}`, {
			status: response.status
		});
	}
}
