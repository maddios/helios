import { ApiError, ConnectionError, TimeoutError, UploadError, type HeliosError } from "../errors.js";
import type { TransportSettings } from "../options.js";
import { exchange, type RawResponse } from "./exchange.js";
import { errorFromResponse } from "./mapError.js";
import { buildUrl, parseErrorBody, type QueryValue } from "./request.js";
import { retryAfterMs, RetryableError, withRetry } from "./retry.js";

/** HTTP methods the API uses. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Which failures a call retries.
 *
 * - `idempotent`: 429, 5xx, network errors and timeouts. Used for GET, PUT and DELETE, and for POSTs that carry an
 *   idempotency key, so a repeat cannot create a duplicate.
 * - `rateLimitOnly`: 429 only. Used for every other write, since the server may have acted before the failure.
 */
export type RetryMode = "idempotent" | "rateLimitOnly";

/** A JSON call to the Helios API. */
export interface JsonRequest {
	method: HttpMethod;
	path: string;
	query?: Record<string, QueryValue>;
	body?: unknown;
	/** Which failures this call retries. Every call states it explicitly. */
	retry: RetryMode;
	signal?: AbortSignal;
}

/** Options of a direct upload PUT to a presigned storage URL. */
export interface PutOptions {
	contentType?: string;
	timeoutMs: number;
	signal?: AbortSignal;
}

/**
 * Sends requests with the API key, typed JSON, per-attempt timeouts and retries that follow each call's {@link RetryMode}.
 * Retries reuse the same body, so idempotency keys stay stable across attempts.
 */
export class Transport {
	/**
	 * @param settings Validated settings, including the fetch implementation.
	 * @internal
	 */
	constructor(private readonly settings: TransportSettings) {}

	/**
	 * Calls a JSON endpoint and returns the parsed body.
	 *
	 * @param request Method, path, query, body, retry mode and cancellation.
	 * @returns The parsed response body, or `undefined` for 204 responses.
	 * @throws {HeliosError} The mapped API error, once retries are exhausted or when the error is not retryable.
	 * @throws {ApiError} With code `invalid_response` when a 2xx body is not JSON.
	 */
	json<T>(request: JsonRequest): Promise<T> {
		const url = buildUrl(this.settings.baseUrl, request.path, request.query);
		const init: RequestInit = {
			method: request.method,
			headers: {
				authorization: `Bearer ${this.settings.apiKey}`,
				accept: "application/json",
				...(request.body !== undefined && { "content-type": "application/json" })
			},
			body: request.body === undefined ? undefined : JSON.stringify(request.body)
		};
		return this.retrying(request.signal, async () => {
			const res = await this.send(request.retry, url, init, this.settings.timeoutMs, request.signal);
			if (res.status === 204) {
				return undefined as T;
			}
			if (isSuccess(res.status)) {
				return successBody<T>(res);
			}
			throw this.apiFailure(request.retry, res);
		});
	}

	/**
	 * PUTs bytes to a presigned storage URL and returns the part's ETag. A PUT is idempotent, so it is retried on 5xx,
	 * 429, network errors and timeouts.
	 *
	 * @param url Presigned URL.
	 * @param body Bytes to upload.
	 * @param options Content type, timeout and cancellation.
	 * @returns The `ETag` header of the stored object or part, or `null` when storage did not send one.
	 * @throws {UploadError} When storage rejects the upload.
	 */
	put(url: string, body: Uint8Array, options: PutOptions): Promise<string | null> {
		const init: RequestInit = {
			method: "PUT",
			body,
			headers: options.contentType === undefined ? {} : { "content-type": options.contentType }
		};
		return this.retrying(options.signal, async () => {
			const res = await this.send("idempotent", url, init, options.timeoutMs, options.signal);
			if (isSuccess(res.status)) {
				return res.headers.get("etag");
			}
			const error = new UploadError("upload_failed", `Upload was rejected with status ${res.status}`, {
				status: res.status
			});
			throw isRetryableStatus("idempotent", res.status) ? new RetryableError(error, retryAfterOf(res)) : error;
		});
	}

	private retrying<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
		return withRetry(run, {
			maxRetries: this.settings.maxRetries,
			baseDelayMs: this.settings.retryBaseDelayMs,
			maxRetryAfterMs: this.settings.maxRetryAfterMs,
			signal
		});
	}

	private async send(
		mode: RetryMode,
		url: string,
		init: RequestInit,
		timeoutMs: number,
		signal?: AbortSignal
	): Promise<RawResponse> {
		try {
			return await exchange(this.settings.fetch, url, init, timeoutMs, signal);
		} catch (err) {
			const transient = err instanceof TimeoutError || err instanceof ConnectionError;
			throw mode === "idempotent" && transient ? new RetryableError(err) : err;
		}
	}

	private apiFailure(mode: RetryMode, res: RawResponse): HeliosError | RetryableError {
		const error = errorFromResponse(res.status, parseErrorBody(res.text), res.headers);
		return isRetryableStatus(mode, res.status) ? new RetryableError(error, retryAfterOf(res)) : error;
	}
}

function successBody<T>(res: RawResponse): T {
	try {
		return JSON.parse(res.text) as T;
	} catch (err) {
		throw new ApiError("invalid_response", `The API returned a ${res.status} response that is not JSON`, {
			status: res.status,
			requestId: res.headers.get("x-request-id") ?? undefined,
			cause: err
		});
	}
}

function retryAfterOf(res: RawResponse): number | undefined {
	return retryAfterMs(res.headers.get("retry-after"));
}

function isSuccess(status: number): boolean {
	return status >= 200 && status < 300;
}

function isRetryableStatus(mode: RetryMode, status: number): boolean {
	return status === 429 || (mode === "idempotent" && status >= 500);
}
