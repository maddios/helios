import { integerIn } from "../validation.js";

/** Bytes sent so far and the total, reported after each part or the single PUT. */
export interface UploadProgress {
	/** Bytes uploaded so far. */
	uploadedBytes: number;
	/** Total size of the upload in bytes. */
	totalBytes: number;
}

const FIVE_GIB = 5 * 1024 * 1024 * 1024;

/** Defaults applied by the upload orchestration. */
export const UPLOAD_DEFAULTS = {
	concurrency: 4,
	multipartThresholdBytes: 100 * 1024 * 1024,
	partTimeoutMs: 5 * 60_000
} as const;

/**
 * Options of the upload methods.
 *
 * @example
 * const options: UploadOptions = { filename: "clip.mp4", onProgress: ({ uploadedBytes, totalBytes }) => log(uploadedBytes / totalBytes) };
 */
export interface UploadOptions {
	/** Name stored with the upload. Defaults to the basename of a path; required for other inputs. */
	filename?: string;
	/** Size in bytes; required for stream inputs, detected for every other kind. */
	sizeBytes?: number;
	/** MIME type stored with the object. Defaults to none. */
	contentType?: string;
	/** Called after each part (or the single PUT) completes. */
	onProgress?: (progress: UploadProgress) => void;
	/** Cancels the upload. A multipart upload is aborted on the server before the error is thrown. */
	signal?: AbortSignal;
	/** Parts uploaded in parallel, from 1 to 16. Defaults to 4. */
	concurrency?: number;
	/** Inputs larger than this use multipart upload, from 1 byte to 5 GiB. Defaults to 104857600 (100 MiB). */
	multipartThresholdBytes?: number;
	/** Timeout of each part PUT, in milliseconds, from 1 to 3600000. Defaults to 300000 (5 minutes). */
	partTimeoutMs?: number;
}

/** Upload options with defaults applied and bounds checked. */
export interface UploadSettings {
	concurrency: number;
	multipartThresholdBytes: number;
	partTimeoutMs: number;
}

/**
 * Applies the defaults to the upload options and checks their bounds.
 *
 * @param options The caller's upload options.
 * @returns The effective settings.
 * @throws {ConfigurationError} When a number is out of range.
 */
export function resolveUploadSettings(options: UploadOptions): UploadSettings {
	return {
		concurrency: integerIn("concurrency", options.concurrency ?? UPLOAD_DEFAULTS.concurrency, 1, 16),
		multipartThresholdBytes: integerIn(
			"multipartThresholdBytes",
			options.multipartThresholdBytes ?? UPLOAD_DEFAULTS.multipartThresholdBytes,
			1,
			FIVE_GIB
		),
		partTimeoutMs: integerIn("partTimeoutMs", options.partTimeoutMs ?? UPLOAD_DEFAULTS.partTimeoutMs, 1, 3_600_000)
	};
}
