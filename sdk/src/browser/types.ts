/** A part with its presigned PUT URL, as returned by `createMultipart` or `signParts`. */
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
 * The multipart upload the backend created with `uploads.createMultipart` and passed to the browser. The uploader reads
 * `partSizeBytes` and `parts`; `uploadId` and `uploadKey` travel with it so the backend can complete the upload.
 *
 * @example
 * const upload: MultipartUpload = { uploadId, uploadKey, partSizeBytes, parts };
 */
export interface MultipartUpload {
	/** Multipart upload id. */
	uploadId: string;
	/** Storage key of the upload, which the backend passes to `completeMultipart`. */
	uploadKey: string;
	/** Size of every part except possibly the last, in bytes. */
	partSizeBytes: number;
	/** Presigned URL of each part, numbered from 1 to the planned part count. */
	parts: PartUrl[];
}

/** A part storage accepted, as the backend passes it to `completeMultipart`. */
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
 * A presigned single PUT, as returned by `uploads.presign`.
 *
 * @example
 * const presigned: PresignedUpload = { url, headers: { "content-type": "video/mp4" } };
 */
export interface PresignedUpload {
	/** Presigned URL to PUT the file to. */
	url: string;
	/** Headers the signature covers, such as `content-type`. Sent as given. */
	headers?: Record<string, string>;
}
