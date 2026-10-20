import type {
	CompleteUploadRequest,
	CompleteUploadResponse,
	CreateUploadRequest,
	CreateUploadResponse
} from "../types.js";
import { UploadCompleteError, UploadError } from "../errors.js";
import type { UploadApi } from "./api.js";
import { openSource, toBuffer, type Source, type UploadInput } from "./input.js";
import { uploadMultipart, type CompletedPart } from "./multipart.js";
import {
	resolveUploadSettings,
	type UploadCall,
	type UploadOptions,
	type UploadSettings,
	type UploadTarget
} from "./options.js";

type SingleCreated = Extract<CreateUploadResponse, { mode: "single" }>;

/**
 * Stores a file: creates the upload, sends the bytes with one PUT or in parts as the server decided, then completes it.
 *
 * The file is kept with `store: true`, or stored and encoded with `encode`. A multipart upload is aborted on the server
 * when sending the bytes fails. When `complete` fails, the error is an {@link UploadCompleteError} carrying the file id.
 *
 * @param api Upload operations of the API.
 * @param input File path, Buffer, stream or Blob.
 * @param options Upload options and the target.
 * @returns The stored file, and the encode request when `encode` was given.
 * @throws {ValidationError} When a filename or stream size is missing, or the server rejects the request.
 * @throws {ConfigurationError} When a sizing option is out of range.
 * @throws {UploadError} When storage rejects a part or the size does not match.
 * @throws {UploadCompleteError} When `uploads.complete` fails after the bytes were sent.
 * @throws {AbortedError} When `options.signal` fires.
 */
export async function storeUpload(
	api: UploadApi,
	input: UploadInput,
	options: UploadCall
): Promise<CompleteUploadResponse> {
	const settings = resolveUploadSettings(options);
	const source = await openSource(input, options);
	const created = await api.create(createRequest(source, options), options.signal);
	const parts = await sendBytes(api, created, source, options, settings);
	return completeStored(api, created.fileId, completeRequest(options, parts), options);
}

async function sendBytes(
	api: UploadApi,
	created: CreateUploadResponse,
	source: Source,
	options: UploadOptions,
	settings: UploadSettings
): Promise<CompletedPart[] | undefined> {
	try {
		if (created.mode === "single") {
			await putSingle(api, created, source, options, settings);
			return undefined;
		}
		return await uploadMultipart(api, created, source, options, settings);
	} catch (err) {
		if (created.mode === "multipart") {
			await api.abort(created.fileId).catch(() => undefined);
		}
		throw err;
	}
}

async function completeStored(
	api: UploadApi,
	fileId: string,
	request: CompleteUploadRequest,
	options: UploadOptions
): Promise<CompleteUploadResponse> {
	try {
		return await api.complete(fileId, request, options.signal);
	} catch (err) {
		throw new UploadCompleteError(fileId, err);
	}
}

function createRequest(source: Source, options: UploadOptions): CreateUploadRequest {
	return {
		filename: source.filename,
		sizeBytes: source.sizeBytes,
		contentType: options.contentType,
		...(options.externalId !== undefined && { externalId: options.externalId }),
		...(options.policy !== undefined && { policy: options.policy })
	};
}

function completeRequest(target: UploadTarget, parts: CompletedPart[] | undefined): CompleteUploadRequest {
	const completion = "encode" in target ? { encode: target.encode } : { store: true as const };
	return parts === undefined ? completion : { parts, ...completion };
}

async function putSingle(
	api: UploadApi,
	created: SingleCreated,
	source: Source,
	options: UploadOptions,
	settings: UploadSettings
): Promise<void> {
	const body = Buffer.concat(await collect(source.chunks));
	if (body.byteLength !== source.sizeBytes) {
		throw new UploadError(
			"size_mismatch",
			`The source yielded ${body.byteLength} bytes, but ${source.sizeBytes} were declared`
		);
	}
	await api.putObject(created.url, body, {
		headers: created.headers,
		timeoutMs: settings.partTimeoutMs,
		signal: options.signal
	});
	options.onProgress?.({ uploadedBytes: body.byteLength, totalBytes: source.sizeBytes });
}

async function collect(chunks: Source["chunks"]): Promise<Buffer[]> {
	const buffers: Buffer[] = [];
	for await (const chunk of chunks) {
		buffers.push(toBuffer(chunk));
	}
	return buffers;
}
