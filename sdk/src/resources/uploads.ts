import type {
	CompleteUploadRequest,
	CompleteUploadResponse,
	CreateUploadRequest,
	CreateUploadResponse,
	SignUploadPartsResponse,
	UploadPartsListResponse
} from "../types.js";
import type { Transport } from "../transport/transport.js";
import type { UploadApi } from "../uploads/api.js";
import type { UploadInput } from "../uploads/input.js";
import type { UploadCall } from "../uploads/options.js";
import { storeUpload } from "../uploads/store.js";

/** Cancellation of a single call. */
export interface UploadCallOptions {
	/** Cancels the call. */
	signal?: AbortSignal;
}

/**
 * Stores files in Helios: one call uploads a file and keeps it, or stores it and encodes it. Small files go up in one
 * PUT and large files in parts; the SDK follows the server's choice. The steps are available too, for callers that drive
 * the bytes themselves (see `@partnrup/helios-sdk/browser` for uploads from the browser).
 *
 * @example
 * const { file } = await helios.uploads.upload("./logo.png", { contentType: "image/png", store: true });
 */
export class Uploads {
	private readonly api: UploadApi;

	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {
		this.api = {
			create: (request, signal) => this.create(request, { signal }),
			complete: (fileId, request, signal) => this.complete(fileId, request, { signal }),
			abort: (fileId) => this.abort(fileId),
			putObject: (url, body, options) => transport.put(url, body, options)
		};
	}

	/**
	 * Uploads a file and keeps it (`store: true`) or stores it and encodes it (`encode`).
	 *
	 * Storage checks the bytes against the declared content type and the upload policy. A file that fails the check is
	 * rejected and its object deleted. Calling again with the same `fileId` is safe: a completed file is returned as it is.
	 *
	 * @param input File path, Buffer, readable stream or Blob.
	 * @param options Content type, filename, progress, cancellation and the target: `{ store: true }` or `{ encode }`.
	 * @returns The stored file, and the encode request when `encode` was given.
	 * @throws {ValidationError} When a filename, size or option is invalid (400).
	 * @throws {UnprocessableError} When the file violates the upload policy (422, code `policy_violation`).
	 * @throws {UploadError} When storage rejects a part or the size does not match.
	 * @throws {AbortedError} When `options.signal` fires.
	 * @example
	 * const { file, request } = await helios.uploads.upload("./clip.mp4", {
	 *   contentType: "video/mp4",
	 *   encode: { preset: "generic" }
	 * });
	 */
	upload(input: UploadInput, options: UploadCall): Promise<CompleteUploadResponse> {
		return storeUpload(this.api, input, options);
	}

	/**
	 * Creates an upload. Storage decides between one presigned PUT and a multipart upload, from the file size.
	 *
	 * @param request Filename, byte size, content type and optional externalId and narrower policy.
	 * @param options Cancellation.
	 * @returns The file id, the storage key and either one presigned PUT (`mode: "single"`) or the part URLs (`mode: "multipart"`).
	 * @throws {ValidationError} When the size exceeds the upload limit or the request is invalid (400).
	 * @throws {UnprocessableError} When the content type or size is not allowed by the upload policy (422).
	 * @example
	 * const created = await helios.uploads.create({ filename: "clip.mp4", sizeBytes, contentType: "video/mp4" });
	 */
	create(request: CreateUploadRequest, options: UploadCallOptions = {}): Promise<CreateUploadResponse> {
		return this.transport.json<CreateUploadResponse>({
			method: "POST",
			path: "/uploads",
			body: request,
			retry: "rateLimitOnly",
			signal: options.signal
		});
	}

	/**
	 * Completes an upload. Multipart uploads pass their uploaded parts. `store: true` keeps the file; `encode` stores it and
	 * starts an encode with the file as its source.
	 *
	 * Completing is idempotent per file: a second call returns the stored file, and an encode without `requestId` reuses
	 * the request of the first call. Storage re-checks the bytes here, so a policy violation is reported by this call.
	 *
	 * @param fileId File id from {@link create}.
	 * @param request Uploaded parts (multipart only) and the target.
	 * @param options Cancellation.
	 * @returns The stored file, and the encode request when `encode` was given.
	 * @throws {ValidationError} When parts are missing or given for a single PUT (400).
	 * @throws {NotFoundError} When the file does not exist (404).
	 * @throws {ConflictError} When the file failed or was aborted (409).
	 * @throws {UnprocessableError} When the object is missing or violates the policy (422).
	 * @example
	 * const { file } = await helios.uploads.complete(created.fileId, { store: true });
	 */
	complete(
		fileId: string,
		request: CompleteUploadRequest,
		options: UploadCallOptions = {}
	): Promise<CompleteUploadResponse> {
		return this.transport.json<CompleteUploadResponse>({
			method: "POST",
			path: `/uploads/${encodeURIComponent(fileId)}/complete`,
			body: request,
			retry: "idempotent",
			signal: options.signal
		});
	}

	/**
	 * Presigns fresh PUT URLs for some parts of a multipart upload, such as after URLs expired.
	 *
	 * @param fileId File id from {@link create}.
	 * @param partNumbers Unique 1-based part numbers, at most 1000 per call and within the planned part count.
	 * @param options Cancellation.
	 * @returns One fresh presigned URL per part number, and when they expire.
	 * @throws {ValidationError} When a part number is out of range or the upload is not multipart (400).
	 * @throws {ConflictError} When the file is no longer pending (409).
	 * @example
	 * const { parts } = await helios.uploads.signParts(created.fileId, [3, 4]);
	 */
	signParts(fileId: string, partNumbers: number[], options: UploadCallOptions = {}): Promise<SignUploadPartsResponse> {
		return this.transport.json<SignUploadPartsResponse>({
			method: "POST",
			path: `/uploads/${encodeURIComponent(fileId)}/parts`,
			body: { partNumbers },
			retry: "idempotent",
			signal: options.signal
		});
	}

	/**
	 * Lists the parts storage holds for a multipart upload, so an interrupted upload can resume without re-sending them.
	 *
	 * @param fileId File id from {@link create}.
	 * @param options Cancellation.
	 * @returns The uploaded parts, sorted by part number, with their ETags and sizes.
	 * @throws {ConflictError} When the file is no longer pending (409).
	 * @example
	 * const { parts } = await helios.uploads.listParts(created.fileId);
	 */
	listParts(fileId: string, options: UploadCallOptions = {}): Promise<UploadPartsListResponse> {
		return this.transport.json<UploadPartsListResponse>({
			method: "GET",
			path: `/uploads/${encodeURIComponent(fileId)}/parts`,
			retry: "idempotent",
			signal: options.signal
		});
	}

	/**
	 * Aborts a pending upload and discards what it stored.
	 *
	 * @param fileId File id from {@link create}.
	 * @returns Resolves once the upload is aborted (HTTP 204).
	 * @throws {ConflictError} When the file is no longer pending (409).
	 * @example
	 * await helios.uploads.abort(created.fileId);
	 */
	abort(fileId: string): Promise<void> {
		return this.transport.json<void>({
			method: "DELETE",
			path: `/uploads/${encodeURIComponent(fileId)}`,
			retry: "idempotent"
		});
	}
}
