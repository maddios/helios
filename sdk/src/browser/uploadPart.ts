import { BrowserUploadError, EtagUnavailableError, NetworkError, PartUrlExpiredError } from "./errors.js";
import type { PlannedPart } from "./plan.js";
import { sleep } from "./sleep.js";
import { putBlob } from "./xhr.js";
import type { PartUrl, UploadedPart } from "./types.js";

/** What one part upload needs besides the part itself. */
export interface PartContext {
	signal: AbortSignal;
	maxPartRetries: number;
	signParts?: (partNumbers: number[]) => Promise<PartUrl[]>;
	onBytes: (partNumber: number, loadedBytes: number) => void;
}

const BACKOFF_BASE_MS = 200;
const BACKOFF_MAX_MS = 5000;

/**
 * Uploads one part, retrying network errors and 5xx or 429 responses with backoff. A 403 renews the part's URL once
 * through `signParts`, then retries.
 *
 * @param part The planned part.
 * @param body The bytes of the part.
 * @param context Cancellation, retry limit, URL renewal and progress.
 * @returns The part number, ETag and size.
 * @throws {EtagUnavailableError} When storage answers without an ETag.
 * @throws {PartUrlExpiredError} When a 403 cannot be renewed.
 * @throws {BrowserUploadError} With code `part_rejected` for other non-retryable statuses, or after retries run out.
 */
export async function uploadPart(part: PlannedPart, body: Blob, context: PartContext): Promise<UploadedPart> {
	let url = part.url;
	let renewed = false;
	let retries = 0;
	for (;;) {
		let failure: BrowserUploadError;
		try {
			const response = await putBlob({
				url,
				body,
				headers: {},
				partNumber: part.partNumber,
				onUploadProgress: (loaded) => context.onBytes(part.partNumber, loaded),
				signal: context.signal
			});
			if (isSuccess(response.status)) {
				if (response.etag === null) {
					throw new EtagUnavailableError(part.partNumber);
				}
				context.onBytes(part.partNumber, body.size);
				return { partNumber: part.partNumber, etag: response.etag, sizeBytes: body.size };
			}
			if (response.status === 403) {
				if (renewed || context.signParts === undefined) {
					throw new PartUrlExpiredError(part.partNumber, response.status);
				}
				renewed = true;
				url = await renewUrl(part.partNumber, context.signParts);
				continue;
			}
			failure = new BrowserUploadError("part_rejected", `Storage rejected part ${part.partNumber}`, {
				partNumber: part.partNumber,
				status: response.status
			});
			if (!isRetryableStatus(response.status)) {
				throw failure;
			}
		} catch (error) {
			if (!(error instanceof NetworkError)) {
				throw error;
			}
			failure = error;
		}
		if (retries >= context.maxPartRetries) {
			throw failure;
		}
		retries++;
		await sleep(Math.min(BACKOFF_BASE_MS * 2 ** (retries - 1), BACKOFF_MAX_MS), context.signal);
	}
}

async function renewUrl(partNumber: number, signParts: (partNumbers: number[]) => Promise<PartUrl[]>): Promise<string> {
	const renewed = (await signParts([partNumber])).find((part) => part.partNumber === partNumber);
	if (renewed === undefined) {
		throw new PartUrlExpiredError(partNumber, 403);
	}
	return renewed.url;
}

function isSuccess(status: number): boolean {
	return status >= 200 && status < 300;
}

function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}
