import { BrowserUploadError } from "./errors.js";
import { putBlob } from "./xhr.js";
import type { PresignedUpload, UploadSingleOptions } from "./types.js";

/**
 * Uploads a file with one presigned PUT, from the browser. Use it for the `mode: "single"` result of `uploads.create`.
 *
 * The request sends `presigned.headers` exactly. Those are the headers the server signed, so they must come from
 * `uploads.create` unchanged. The browser sets `Content-Length` itself, and the signature covers it.
 *
 * @param presigned The presigned URL and the headers the signature covers, from `uploads.create`.
 * @param file The file to upload.
 * @param options Progress and cancellation.
 * @returns Resolves once storage accepts the file.
 * @throws {BrowserUploadError} With code `upload_failed` when storage rejects the file, with its HTTP status.
 * @throws {BrowserUploadError} With code `aborted` when the signal fires.
 * @example
 * const created = await fetch("/api/uploads", { method: "POST", body }).then((r) => r.json());
 * await uploadSingle(created, file);
 */
export async function uploadSingle(
	presigned: PresignedUpload,
	file: Blob,
	options: UploadSingleOptions = {}
): Promise<void> {
	const response = await putBlob({
		url: presigned.url,
		body: file,
		headers: presigned.headers,
		onUploadProgress: (loadedBytes) => options.onProgress?.({ uploadedBytes: loadedBytes, totalBytes: file.size }),
		signal: options.signal
	});
	if (response.status < 200 || response.status >= 300) {
		throw new BrowserUploadError("upload_failed", `Storage rejected the upload with status ${response.status}`, {
			status: response.status
		});
	}
}
