import type {
	MultipartCompleteResponse,
	MultipartCreateRequest,
	MultipartCreateResponse,
	PresignedUploadRequest,
	PresignedUploadResponse,
	RequestView
} from "@helios/contracts";
import { AbortedError, HeliosError, UploadEncodeError } from "../errors.js";
import { withIdempotencyKey } from "../idempotency.js";
import type { UploadApi } from "../uploads/api.js";
import type { UploadInput } from "../uploads/input.js";
import type { UploadOptions } from "../uploads/options.js";
import { storeUpload } from "../uploads/store.js";
import type { Transport } from "../transport/transport.js";
import type { EncodeOptions, MultipartCompleteRequest } from "../types.js";
import type { Encodes } from "./encodes.js";

/** Options of {@link Uploads.uploadAndEncode}: upload options plus the encode options. */
export type UploadAndEncodeOptions = UploadOptions & EncodeOptions;

/** Result of {@link Uploads.uploadAndEncode}. */
export interface UploadAndEncodeResult {
	/** Storage key of the uploaded object. */
	uploadKey: string;
	/** The encode request created for the upload. */
	request: RequestView;
}

/** Cancellation of a single call. */
export interface UploadCallOptions {
	/** Cancels the call. */
	signal?: AbortSignal;
}

/**
 * Uploads media to Helios storage, with direct presigned PUTs or multipart upload for large files.
 *
 * `upload` and `uploadAndEncode` handle everything. The lower-level methods (`presign`, `createMultipart`,
 * `completeMultipart`, `abortMultipart`) are for callers that drive the storage PUTs themselves.
 *
 * @example
 * const { uploadKey, request } = await helios.uploads.uploadAndEncode("./clip.mp4", { preset: "generic" });
 */
export class Uploads {
	private readonly api: UploadApi;

	/**
	 * @param transport Shared HTTP transport.
	 * @param encodes Encode resource, used by {@link uploadAndEncode}.
	 * @internal
	 */
	constructor(
		private readonly transport: Transport,
		private readonly encodes: Encodes
	) {
		this.api = {
			presign: (request, signal) => this.presign(request, { signal }),
			createMultipart: (request, signal) => this.createMultipart(request, { signal }),
			completeMultipart: (uploadId, request, signal) => this.completeMultipart(uploadId, request, { signal }),
			abortMultipart: (uploadId, uploadKey) => this.abortMultipart(uploadId, uploadKey),
			putObject: (url, body, options) => transport.put(url, body, options)
		};
	}

	/**
	 * Uploads a file, Buffer, stream or Blob and returns its upload key.
	 *
	 * Inputs up to `multipartThresholdBytes` (default 100 MiB) use one presigned PUT. Larger inputs use multipart upload:
	 * parts are sent with bounded concurrency and per-part retries, and the upload is aborted on the server if any part
	 * fails or the signal fires.
	 *
	 * @param input File path, Buffer, readable stream or Blob. Streams need `sizeBytes`; Buffers, streams and Blobs need `filename`.
	 * @param options Filename, content type, progress, cancellation and sizing.
	 * @returns The upload key, to pass as `source: { uploadKey }` to `encodes.create`.
	 * @throws {ValidationError} When a required filename or size is missing.
	 * @throws {ConfigurationError} When a sizing option is out of range.
	 * @throws {UploadError} When storage rejects a part or the size does not match.
	 * @throws {AbortedError} When `options.signal` fires.
	 * @example
	 * const uploadKey = await helios.uploads.upload("./master.mov", { onProgress: ({ uploadedBytes, totalBytes }) => {} });
	 */
	upload(input: UploadInput, options: UploadOptions = {}): Promise<string> {
		return storeUpload(this.api, input, options);
	}

	/**
	 * Uploads an input and starts an encode of it in one call.
	 *
	 * The encode request carries a generated `requestId`, so retries of the encode never duplicate it. If the upload is
	 * stored but the encode fails, the error is an {@link UploadEncodeError} that carries the `uploadKey`.
	 *
	 * @param input File path, Buffer, readable stream or Blob.
	 * @param options Upload options plus encode options, such as `preset`, `postProcess` and `callbackUrl`.
	 * @returns The upload key and the encode request.
	 * @throws {ValidationError} When a required filename, size or encode field is invalid.
	 * @throws {UploadEncodeError} When the upload is stored but the encode request fails. Its `uploadKey` can be encoded again.
	 * @throws {UploadError} When storage rejects a part.
	 * @throws {AbortedError} When `options.signal` fires.
	 * @example
	 * const { request } = await helios.uploads.uploadAndEncode("./clip.mp4", { preset: "generic" });
	 */
	async uploadAndEncode(input: UploadInput, options: UploadAndEncodeOptions): Promise<UploadAndEncodeResult> {
		const {
			filename,
			sizeBytes,
			contentType,
			onProgress,
			signal,
			concurrency,
			multipartThresholdBytes,
			partTimeoutMs,
			...encode
		} = options;
		const uploadKey = await storeUpload(this.api, input, options);
		try {
			const request = await this.encodes.create({ ...encode, source: { uploadKey } }, { signal });
			return { uploadKey, request };
		} catch (err) {
			if (err instanceof AbortedError || !(err instanceof HeliosError)) {
				throw err;
			}
			throw new UploadEncodeError(uploadKey, err);
		}
	}

	/**
	 * Gets one presigned URL for a single PUT of up to 5 GB.
	 *
	 * @param request Filename, byte size and optional content type.
	 * @param options Cancellation.
	 * @returns The upload key and the presigned URL, which expires at `expiresAt`.
	 * @throws {ValidationError} When the size exceeds the upload limit (400).
	 * @example
	 * const { url, uploadKey } = await helios.uploads.presign({ filename: "a.jpg", sizeBytes: 1024 });
	 */
	presign(request: PresignedUploadRequest, options: UploadCallOptions = {}): Promise<PresignedUploadResponse> {
		return this.transport.json<PresignedUploadResponse>({
			method: "POST",
			path: "/uploads/presigned",
			body: request,
			retry: "rateLimitOnly",
			signal: options.signal
		});
	}

	/**
	 * Starts a multipart upload and returns presigned URLs for every part.
	 *
	 * The API returns all part URLs up front, so there is no separate call to sign parts later. The part URLs stay valid for
	 * `UPLOAD_URL_EXPIRY_SEC` on the server, which is at least six hours.
	 *
	 * @param request Filename, total byte size and optional content type.
	 * @param options Cancellation.
	 * @returns The upload id, the upload key, the part size and one presigned URL per part.
	 * @throws {ValidationError} When the size exceeds the upload limit or needs parts larger than 5 GiB (400).
	 * @example
	 * const { uploadId, parts, partSizeBytes } = await helios.uploads.createMultipart({ filename, sizeBytes });
	 */
	createMultipart(request: MultipartCreateRequest, options: UploadCallOptions = {}): Promise<MultipartCreateResponse> {
		return this.transport.json<MultipartCreateResponse>({
			method: "POST",
			path: "/uploads/multipart",
			body: request,
			retry: "rateLimitOnly",
			signal: options.signal
		});
	}

	/**
	 * Completes a multipart upload from the ETags of its uploaded parts.
	 *
	 * With `encode` options, the encode request gets a generated `requestId`, so the call is retried safely. Without them,
	 * the call is retried only on rate limits.
	 *
	 * @param uploadId Upload id from {@link createMultipart}.
	 * @param request The upload key, the uploaded parts and optional encode options.
	 * @param options Cancellation.
	 * @returns The completed upload key, and the request when encode options were given.
	 * @throws {ValidationError} When the parts are invalid (400).
	 * @throws {PermissionError} When the upload key belongs to another account (403).
	 * @example
	 * await helios.uploads.completeMultipart(uploadId, { uploadKey, parts: [{ partNumber: 1, etag }] });
	 */
	completeMultipart(
		uploadId: string,
		request: MultipartCompleteRequest,
		options: UploadCallOptions = {}
	): Promise<MultipartCompleteResponse> {
		const body = request.encode === undefined ? request : { ...request, encode: withIdempotencyKey(request.encode) };
		return this.transport.json<MultipartCompleteResponse>({
			method: "POST",
			path: `/uploads/multipart/${encodeURIComponent(uploadId)}/complete`,
			body,
			retry: request.encode === undefined ? "rateLimitOnly" : "idempotent",
			signal: options.signal
		});
	}

	/**
	 * Aborts a multipart upload and discards its uploaded parts.
	 *
	 * @param uploadId Upload id from {@link createMultipart}.
	 * @param uploadKey Upload key from {@link createMultipart}.
	 * @returns Resolves once the upload is aborted (HTTP 204).
	 * @throws {PermissionError} When the upload key belongs to another account (403).
	 * @example
	 * await helios.uploads.abortMultipart(uploadId, uploadKey);
	 */
	abortMultipart(uploadId: string, uploadKey: string): Promise<void> {
		return this.transport.json<void>({
			method: "DELETE",
			path: `/uploads/multipart/${encodeURIComponent(uploadId)}`,
			query: { uploadKey },
			retry: "idempotent"
		});
	}
}
