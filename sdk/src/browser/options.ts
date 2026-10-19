import { BrowserUploadError } from "./errors.js";
import type { UploadPartsOptions } from "./types.js";

/** Options of {@link uploadParts} with defaults applied and bounds checked. */
export interface ResolvedPartOptions {
	concurrency: number;
	maxPartRetries: number;
}

/**
 * Applies the defaults and checks the numeric options.
 *
 * @param options The caller's options.
 * @returns The effective concurrency and retry count.
 * @throws {BrowserUploadError} With code `invalid_option` when a number is not an integer in range.
 */
export function resolvePartOptions(options: UploadPartsOptions): ResolvedPartOptions {
	return {
		concurrency: integerIn("concurrency", options.concurrency ?? 4, 1, 16),
		maxPartRetries: integerIn("maxPartRetries", options.maxPartRetries ?? 3, 0, 10)
	};
}

function integerIn(name: string, value: number, min: number, max: number): number {
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new BrowserUploadError("invalid_option", `${name} must be an integer from ${min} to ${max}`);
	}
	return value;
}
