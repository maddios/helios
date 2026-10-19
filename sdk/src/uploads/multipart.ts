import type { MultipartCreateResponse } from "@helios/contracts";
import { UploadError } from "../errors.js";
import type { UploadApi } from "./api.js";
import type { Source } from "./input.js";
import { partitionChunks } from "./partition.js";
import { forEachBounded } from "./pool.js";
import type { UploadOptions, UploadSettings } from "./options.js";

interface CompletedPart {
	partNumber: number;
	etag: string;
}

/**
 * Uploads a source in parts and completes the multipart upload. The upload is aborted on the server if any step fails.
 *
 * @param api Upload operations of the API.
 * @param source The normalised input.
 * @param options Progress, cancellation and the resolved settings.
 * @returns The upload key of the completed object.
 * @throws {UploadError} With code `upload_failed`, `missing_etag` or `size_mismatch`.
 * @throws {AbortedError} When `options.signal` fires.
 */
export async function uploadMultipart(
	api: UploadApi,
	source: Source,
	options: UploadOptions & UploadSettings
): Promise<string> {
	const created = await api.createMultipart(
		{ filename: source.filename, sizeBytes: source.sizeBytes, contentType: options.contentType },
		options.signal
	);
	try {
		const parts = await uploadParts(api, created, source, options);
		await api.completeMultipart(created.uploadId, { uploadKey: created.uploadKey, parts }, options.signal);
	} catch (err) {
		await api.abortMultipart(created.uploadId, created.uploadKey).catch(() => undefined);
		throw err;
	}
	return created.uploadKey;
}

async function uploadParts(
	api: UploadApi,
	created: MultipartCreateResponse,
	source: Source,
	options: UploadOptions & UploadSettings
): Promise<CompletedPart[]> {
	const completed: CompletedPart[] = [];
	let uploadedBytes = 0;
	await forEachBounded(
		partitionChunks(source.chunks, created.partSizeBytes),
		options.concurrency,
		async (body, index) => {
			const part = created.parts[index];
			if (part === undefined) {
				throw sizeMismatch("The source is larger than its declared size");
			}
			const etag = await api.putObject(part.url, body, { timeoutMs: options.partTimeoutMs, signal: options.signal });
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
