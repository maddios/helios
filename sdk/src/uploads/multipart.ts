import { UploadError } from "../errors.js";
import type { CreateUploadResponse } from "../types.js";
import type { UploadApi } from "./api.js";
import type { Source } from "./input.js";
import { partitionChunks } from "./partition.js";
import { forEachBounded } from "./pool.js";
import type { UploadOptions, UploadSettings } from "./options.js";

type MultipartCreated = Extract<CreateUploadResponse, { mode: "multipart" }>;

/** A part storage accepted, as `uploads.complete` takes it. */
export interface CompletedPart {
	partNumber: number;
	etag: string;
}

/**
 * Uploads a source in parts to the presigned part URLs of a multipart upload.
 *
 * @param api Upload operations of the API.
 * @param created The multipart upload the server created for the source.
 * @param source The normalised input.
 * @param options Progress and cancellation.
 * @param settings The resolved concurrency and part timeout.
 * @returns The part numbers and ETags, to pass to `uploads.complete`.
 * @throws {UploadError} With code `missing_etag` or `size_mismatch`.
 * @throws {AbortedError} When `options.signal` fires.
 */
export async function uploadMultipart(
	api: UploadApi,
	created: MultipartCreated,
	source: Source,
	options: UploadOptions,
	settings: UploadSettings
): Promise<CompletedPart[]> {
	const completed: CompletedPart[] = [];
	let uploadedBytes = 0;
	await forEachBounded(
		partitionChunks(source.chunks, created.partSizeBytes),
		settings.concurrency,
		async (body, index) => {
			const part = created.parts[index];
			if (part === undefined) {
				throw sizeMismatch("The source is larger than its declared size");
			}
			const etag = await api.putObject(part.url, body, { timeoutMs: settings.partTimeoutMs, signal: options.signal });
			if (etag === null) {
				throw new UploadError("missing_etag", "Storage did not return an ETag for the part");
			}
			completed.push({ partNumber: part.partNumber, etag });
			uploadedBytes += body.byteLength;
			options.onProgress?.({ uploadedBytes, totalBytes: source.sizeBytes });
		}
	);
	if (uploadedBytes !== source.sizeBytes || completed.length !== created.parts.length) {
		throw sizeMismatch(`The source yielded ${uploadedBytes} bytes, but ${source.sizeBytes} were declared`);
	}
	return completed;
}

function sizeMismatch(message: string): UploadError {
	return new UploadError("size_mismatch", message);
}
