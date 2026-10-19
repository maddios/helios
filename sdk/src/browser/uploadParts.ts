import { ProgressTracker } from "./progress.js";
import { resolvePartOptions } from "./options.js";
import { matchUploadedParts, planParts } from "./plan.js";
import { abortedError } from "./errors.js";
import { forwardAbort, runWithConcurrency } from "./pool.js";
import { uploadPart } from "./uploadPart.js";
import type { CompletedPart, MultipartUpload, UploadedPart, UploadPartsOptions } from "./types.js";

/**
 * Uploads a file to the presigned part URLs of a multipart upload, from the browser, and returns the ETag of each part.
 *
 * The file is cut into `partSizeBytes` slices. Each slice is PUT by XHR with bounded concurrency, so progress is reported
 * as bytes are sent. Network errors and 5xx or 429 responses are retried with backoff. A 403 renews the part's URL through
 * `signParts`. Parts listed in `uploadedParts` are skipped, which resumes an interrupted upload. The returned list goes
 * to the backend's `completeMultipart`.
 *
 * Browser CORS must allow the page's origin and expose `ETag` (see the bucket CORS rules).
 *
 * @param upload The upload from the backend: `uploadId`, `uploadKey`, `partSizeBytes` and the part URLs.
 * @param file The file to upload.
 * @param options Concurrency, progress, cancellation, URL renewal, resume and retries.
 * @returns The part number and ETag of every part, sorted by part number.
 * @throws {BrowserUploadError} With code `invalid_option`, `invalid_upload`, `invalid_resume` or `part_rejected`.
 * @throws {BrowserUploadError} With code `aborted` when the signal fires.
 * @throws {EtagUnavailableError} When storage does not expose the ETag header.
 * @throws {PartUrlExpiredError} When a part URL expired and could not be renewed.
 * @example
 * // Backend (secret key): create the upload and pass `upload` to the browser.
 * const upload = await helios.uploads.createMultipart({ filename: file.name, sizeBytes: file.size });
 * // Browser: upload the parts, then return the ETags to the backend.
 * const parts = await uploadParts(upload, file, {
 *   concurrency: 4,
 *   onProgress: ({ uploadedBytes, totalBytes }) => setProgress(uploadedBytes / totalBytes),
 *   signParts: (partNumbers) => fetch("/api/uploads/parts", { method: "POST", body: JSON.stringify(partNumbers) }).then((r) => r.json())
 * });
 * // Backend: await helios.uploads.completeMultipart(upload.uploadId, { uploadKey: upload.uploadKey, parts });
 */
export async function uploadParts(
	upload: MultipartUpload,
	file: Blob,
	options: UploadPartsOptions = {}
): Promise<CompletedPart[]> {
	const { concurrency, maxPartRetries } = resolvePartOptions(options);
	const plan = planParts(file, upload);
	const stored = matchUploadedParts(plan, options.uploadedParts ?? []);
	const progress = new ProgressTracker(file.size, options.onProgress);
	const completed = new Map<number, UploadedPart>(stored);
	for (const part of stored.values()) {
		progress.update(part.partNumber, part.sizeBytes);
	}
	const pending = plan.filter((part) => !stored.has(part.partNumber));
	const controller = new AbortController();
	const detach = forwardAbort(options.signal, controller);
	try {
		await runWithConcurrency(pending, concurrency, controller, async (part) => {
			const uploaded = await uploadPart(part, file.slice(part.start, part.end), {
				signal: controller.signal,
				maxPartRetries,
				signParts: options.signParts,
				onBytes: (partNumber, loaded) => progress.update(partNumber, loaded)
			});
			completed.set(uploaded.partNumber, uploaded);
		});
	} finally {
		detach();
	}
	if (controller.signal.aborted) {
		throw abortedError(controller.signal.reason);
	}
	return [...completed.values()]
		.sort((a, b) => a.partNumber - b.partNumber)
		.map(({ partNumber, etag }) => ({ partNumber, etag }));
}
