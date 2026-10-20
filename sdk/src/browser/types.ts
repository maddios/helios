/** A part with its presigned PUT URL, as returned by `uploads.create` or `uploads.signParts`. */
export interface PartUrl {
	/** 1-based part number. */
	partNumber: number;
	/** Presigned URL to PUT the part to. */
	url: string;
}

/** A part that storage holds, with the ETag it returned and its size. */
export interface UploadedPart {
	/** 1-based part number. */
	partNumber: number;
	/** ETag storage returned for the part, quotes included. */
	etag: string;
	/** Size of the part in bytes. */
	sizeBytes: number;
}

/**
 * The multipart upload the backend created with `uploads.create` and passed to the browser. The uploader reads
 * `partSizeBytes` and `parts`; `uploadId` and `fileId` travel with it so the backend can complete the upload.
 *
 * @example
 * const upload: MultipartUpload = { uploadId, fileId, partSizeBytes, parts };
 */
export interface MultipartUpload {
	/** Multipart upload id. */
	uploadId: string;
	/** File id, which the backend passes to `uploads.complete`. */
	fileId: string;
	/** Size of every part except possibly the last, in bytes. */
	partSizeBytes: number;
	/** Presigned URL of each part, numbered from 1 to the planned part count. */
	parts: PartUrl[];
}

/** A part storage accepted, as the backend passes it to `uploads.complete`. */
export interface CompletedPart {
	/** 1-based part number. */
	partNumber: number;
	/** ETag storage returned for the part, quotes included. */
	etag: string;
}

/** Bytes uploaded so far and the total size of the file. */
export interface UploadProgress {
	/** Bytes uploaded so far. Skipped parts count as uploaded. */
	uploadedBytes: number;
	/** Total size of the file in bytes. */
	totalBytes: number;
}

/**
 * Options of {@link uploadParts}.
 *
 * @example
 * const options: UploadPartsOptions = { concurrency: 4, uploadedParts, signParts: (partNumbers) => renewUrls(partNumbers) };
 */
export interface UploadPartsOptions {
	/** Parts uploaded at the same time, from 1 to 16. Defaults to 4. */
	concurrency?: number;
	/** Called as bytes are sent, and when a part is finished or skipped. The values never decrease. */
	onProgress?: (progress: UploadProgress) => void;
	/** Cancels the upload. In-flight part requests are aborted and the promise rejects with code `aborted`. */
	signal?: AbortSignal;
	/**
	 * Renews the URL of a part that storage rejected with 403. Called at most once per part. Without it, a 403 fails the
	 * upload with {@link PartUrlExpiredError}. Typically calls the backend's re-sign endpoint.
	 */
	signParts?: (partNumbers: number[]) => Promise<PartUrl[]>;
	/** Parts storage already holds, from the backend's `listParts`. They are skipped and returned with their ETags. */
	uploadedParts?: UploadedPart[];
	/** Retries of a part after a network error or a 5xx or 429 response, from 0 to 10. Defaults to 3. */
	maxPartRetries?: number;
}

/**
 * Options of {@link uploadSingle}.
 *
 * @example
 * const options: UploadSingleOptions = { onProgress: ({ uploadedBytes, totalBytes }) => bar(uploadedBytes / totalBytes) };
 */
export interface UploadSingleOptions {
	/** Called as bytes are sent. The values never decrease. */
	onProgress?: (progress: UploadProgress) => void;
	/** Cancels the upload. The promise rejects with code `aborted`. */
	signal?: AbortSignal;
}

/**
 * A presigned single PUT, as returned by `uploads.create` in single mode.
 *
 * @example
 * const presigned: PresignedUpload = created; // from uploads.create, passed by the backend
 */
export interface PresignedUpload {
	/** Presigned URL to PUT the file to. */
	url: string;
	/**
	 * The headers the signature covers: `Content-Type` and `Content-Disposition`, exactly as `uploads.create` returned
	 * them. The PUT sends these and no others, since any other header breaks the signature.
	 */
	headers: Record<string, string>;
}

/**
 * What the backend passes to the browser: the result of `uploads.create`. `mode` says which uploader to call.
 *
 * @example
 * const created: BrowserUpload = await fetch("/api/uploads", { method: "POST", body }).then((r) => r.json());
 */
export type BrowserUpload = SingleBrowserUpload | MultipartBrowserUpload;

/** A single presigned PUT from `uploads.create`, with its mode, as the backend passes it to the browser. */
export interface SingleBrowserUpload extends PresignedUpload {
	/** The upload mode: one presigned PUT. */
	mode: "single";
	/** File id, which the backend passes to `uploads.complete`. */
	fileId: string;
}

/** A multipart upload from `uploads.create`, with its mode, as the backend passes it to the browser. */
export interface MultipartBrowserUpload extends MultipartUpload {
	/** The upload mode: the file is sent in parts. */
	mode: "multipart";
}

/**
 * Result of {@link upload}. Multipart uploads return their parts, which the backend passes to `uploads.complete`.
 *
 * @example
 * const { parts } = await upload(created, file);
 */
export interface BrowserUploadResult {
	/** The uploaded parts, for a multipart upload. Absent for a single PUT. */
	parts?: CompletedPart[];
}
