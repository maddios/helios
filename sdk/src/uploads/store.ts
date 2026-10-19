import { UploadError } from "../errors.js";
import type { UploadApi } from "./api.js";
import { openSource, toBuffer, type Source, type UploadInput } from "./input.js";
import { uploadMultipart } from "./multipart.js";
import { resolveUploadSettings, type UploadOptions } from "./options.js";

/**
 * Stores an input in object storage and returns its upload key.
 *
 * Inputs at or under the multipart threshold use one presigned PUT. Larger inputs use multipart upload with the part
 * size chosen by the server.
 *
 * @param api Upload operations of the API.
 * @param input File path, Buffer, stream or Blob.
 * @param options Filename, progress, cancellation and sizing options.
 * @returns The upload key, to pass as `source: { uploadKey }` to an encode.
 * @throws {ValidationError} When a filename or stream size is missing.
 * @throws {ConfigurationError} When a sizing option is out of range.
 * @throws {UploadError} When storage rejects an upload or the source size does not match.
 * @throws {AbortedError} When `options.signal` fires.
 */
export async function storeUpload(api: UploadApi, input: UploadInput, options: UploadOptions): Promise<string> {
	const settings = resolveUploadSettings(options);
	const source = await openSource(input, options);
	const resolved = { ...options, ...settings };
	return source.sizeBytes <= settings.multipartThresholdBytes
		? putSingle(api, source, resolved)
		: uploadMultipart(api, source, resolved);
}

async function putSingle(
	api: UploadApi,
	source: Source,
	options: UploadOptions & { partTimeoutMs: number }
): Promise<string> {
	const body = Buffer.concat(await collect(source.chunks));
	if (body.byteLength !== source.sizeBytes) {
		throw new UploadError(
			"size_mismatch",
			`The source yielded ${body.byteLength} bytes, but ${source.sizeBytes} were declared`
		);
	}
	const { uploadKey, url } = await api.presign(
		{ filename: source.filename, sizeBytes: source.sizeBytes, contentType: options.contentType },
		options.signal
	);
	await api.putObject(url, body, {
		contentType: options.contentType,
		timeoutMs: options.partTimeoutMs,
		signal: options.signal
	});
	options.onProgress?.({ uploadedBytes: body.byteLength, totalBytes: source.sizeBytes });
	return uploadKey;
}

async function collect(chunks: Source["chunks"]): Promise<Buffer[]> {
	const buffers: Buffer[] = [];
	for await (const chunk of chunks) {
		buffers.push(toBuffer(chunk));
	}
	return buffers;
}
