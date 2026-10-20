import type { EncodeOptions, UploadPolicy } from "../types.js";
import { integerIn } from "../validation.js";

/** Bytes sent so far and the total, reported after each part or the single PUT. */
export interface UploadProgress {
	/** Bytes uploaded so far. */
	uploadedBytes: number;
	/** Total size of the upload in bytes. */
	totalBytes: number;
}

/** Defaults applied by the upload orchestration. */
export const UPLOAD_DEFAULTS = {
	concurrency: 4,
	partTimeoutMs: 5 * 60_000
} as const;

/**
 * Options of the upload methods.
 *
 * @example
 * const options: UploadOptions = { contentType: "video/mp4", filename: "clip.mp4", onProgress: ({ uploadedBytes, totalBytes }) => log(uploadedBytes / totalBytes) };
 */
export interface UploadOptions {
	/** Name stored with the file. Defaults to the basename of a path; required for other inputs. */
	filename?: string;
	/** Size in bytes; required for stream inputs, detected for every other kind. */
	sizeBytes?: number;
	/** MIME type of the file. Storage signs it, and the file is rejected if its bytes say otherwise. */
	contentType: string;
	/** Caller-side identifier stored with the file, for example your own record id. */
	externalId?: string;
	/** Narrower upload policy for this file. It may restrict the account policy, never widen it. */
	policy?: UploadPolicy;
	/** Called after each part (or the single PUT) completes. */
	onProgress?: (progress: UploadProgress) => void;
	/** Cancels the upload. A multipart upload is aborted on the server before the error is thrown. */
	signal?: AbortSignal;
	/** Parts uploaded in parallel, from 1 to 16. Defaults to 4. */
	concurrency?: number;
	/** Timeout of each part PUT, in milliseconds, from 1 to 3600000. Defaults to 300000 (5 minutes). */
	partTimeoutMs?: number;
}

/** Keeps the uploaded file as it is, without encoding it. */
export interface StoreTarget {
	/** Must be `true`. The file is stored and no encode is started. */
	store: true;
}

/** Stores the uploaded file and starts an encode with it as the source. */
export interface EncodeTarget {
	/** Encode options, such as `preset`, `postProcess` and `callbackUrl`. */
	encode: EncodeOptions;
}

/** What to do with the stored file: keep it, or store it and encode it. */
export type UploadTarget = StoreTarget | EncodeTarget;

/** The options of `uploads.upload`: upload options plus the target. */
export type UploadCall = UploadOptions & UploadTarget;

/** Upload options with defaults applied and bounds checked. */
export interface UploadSettings {
	concurrency: number;
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
		partTimeoutMs: integerIn("partTimeoutMs", options.partTimeoutMs ?? UPLOAD_DEFAULTS.partTimeoutMs, 1, 3_600_000)
	};
}
