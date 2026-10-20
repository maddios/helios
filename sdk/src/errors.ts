/** Optional context attached to a {@link HeliosError}. */
export interface ErrorInit {
	/** HTTP status of the response that caused the error; absent for errors raised before a response. */
	status?: number;
	/** Structured details from the server, e.g. zod issues, or client-side context. */
	details?: unknown;
	/** Correlation id of the failing request, from the `x-request-id` header or the error body. */
	requestId?: string;
	/** The underlying error, when this error wraps another one. */
	cause?: unknown;
}

/**
 * Base class of every error thrown by the SDK.
 *
 * Errors from the API carry the server's machine-readable `code`, the HTTP `status` and the `requestId` for support
 * requests. Errors raised locally (configuration, client-side validation, network, webhook signatures) have no `status`.
 *
 * @example
 * try {
 *   await helios.presets.get("missing");
 * } catch (err) {
 *   if (err instanceof HeliosError) console.error(err.code, err.status, err.requestId);
 * }
 */
export class HeliosError extends Error {
	/** Machine-readable error code, e.g. `preset_version_conflict` or `network_error`. */
	readonly code: string;
	/** HTTP status code, or `undefined` when no response was received. */
	readonly status?: number;
	/** Structured details, e.g. zod issues for validation failures. */
	readonly details?: unknown;
	/** Correlation id of the failing request, when the API returned one. */
	readonly requestId?: string;

	/**
	 * @param code Machine-readable error code.
	 * @param message Human-readable message.
	 * @param init Optional status, details, request id and cause.
	 */
	constructor(code: string, message: string, init: ErrorInit = {}) {
		super(message, { cause: init.cause });
		this.name = new.target.name;
		this.code = code;
		this.status = init.status;
		this.details = init.details;
		this.requestId = init.requestId;
	}
}

/**
 * The client was constructed or called with invalid configuration, such as a malformed `baseUrl` or an option out of
 * range.
 *
 * @example
 * new Helios({ apiKey: "", baseUrl: "https://api.example.com" }); // throws ConfigurationError
 */
export class ConfigurationError extends HeliosError {}

/**
 * Any error response from the API, carrying its HTTP `status`. The subclasses below are chosen by status; local
 * validation errors use {@link ValidationError} without a status.
 *
 * @example
 * if (err instanceof ApiError && err.status !== undefined && err.status >= 500) report(err.requestId);
 */
export class ApiError extends HeliosError {}

/**
 * The request was rejected as invalid: HTTP 400 from the API, or a client-side check that failed before sending
 * (then `status` is `undefined`).
 *
 * @example
 * try {
 *   await helios.encodes.create({ source, preset: "BAD NAME" });
 * } catch (err) {
 *   if (err instanceof ValidationError) console.error(err.details);
 * }
 */
export class ValidationError extends ApiError {}

/**
 * The API key is missing, invalid or revoked (HTTP 401).
 *
 * @example
 * if (err instanceof AuthenticationError) rotateKey();
 */
export class AuthenticationError extends ApiError {}

/**
 * The API key lacks the scope the operation needs, e.g. an account key calling an admin operation (HTTP 403).
 *
 * @example
 * if (err instanceof PermissionError) console.error("wrong key scope");
 */
export class PermissionError extends ApiError {}

/**
 * The asset, request, preset or other resource does not exist for this account (HTTP 404).
 *
 * @example
 * if (err instanceof NotFoundError) return null;
 */
export class NotFoundError extends ApiError {}

/**
 * The write conflicts with the current state, e.g. a stale `expectedVersion` or a duplicate preset name (HTTP 409).
 *
 * @example
 * if (err instanceof ConflictError && err.code === "preset_version_conflict") await reload();
 */
export class ConflictError extends ApiError {}

/**
 * The request is well formed but cannot be processed, e.g. an unfetchable source or nothing to encode (HTTP 422).
 *
 * @example
 * if (err instanceof UnprocessableError && err.code === "source_not_found") markMissing();
 */
export class UnprocessableError extends ApiError {}

/**
 * The API rate-limited the request (HTTP 429). The SDK retries up to `maxRetries` times, honouring `Retry-After`, but
 * never waits longer than `maxRetryAfterMs`: a longer `Retry-After` throws this error at once, with `retryAfterMs` set.
 *
 * @example
 * if (err instanceof RateLimitError) queueForLater(err.retryAfterMs);
 */
export class RateLimitError extends ApiError {
	/** The `Retry-After` delay the server asked for, in milliseconds, when it sent one. */
	readonly retryAfterMs?: number;

	/**
	 * @param code Machine-readable error code.
	 * @param message Human-readable message.
	 * @param init Optional details, request id and the server's retry delay.
	 */
	constructor(code: string, message: string, init: ErrorInit & { retryAfterMs?: number } = {}) {
		super(code, message, init);
		this.retryAfterMs = init.retryAfterMs;
	}
}

/**
 * The API is temporarily unavailable (HTTP 503). The SDK retries up to `maxRetries` times before throwing.
 *
 * @example
 * if (err instanceof ServiceUnavailableError) scheduleRetry();
 */
export class ServiceUnavailableError extends ApiError {}

/**
 * The request could not reach the API (DNS, connection reset, TLS). Idempotent requests are retried before this is
 * thrown; other writes are not retried.
 *
 * @example
 * if (err instanceof ConnectionError) console.error("API unreachable", err.cause);
 */
export class ConnectionError extends HeliosError {}

/**
 * The request or a single attempt exceeded its timeout, or {@link Requests.wait} gave up.
 *
 * @example
 * if (err instanceof TimeoutError) console.error("still running after the deadline");
 */
export class TimeoutError extends HeliosError {}

/**
 * The caller's `AbortSignal` fired before the operation completed. Multipart uploads are aborted server side first.
 *
 * @example
 * const controller = new AbortController();
 * setTimeout(() => controller.abort(), 60_000);
 * await helios.uploads.upload(file, { signal: controller.signal }); // throws AbortedError after 60s
 */
export class AbortedError extends HeliosError {}

/**
 * A direct upload to storage failed, or the part layout did not match the declared size (`size_mismatch`).
 *
 * @example
 * if (err instanceof UploadError && err.status === 403) await restartUpload();
 */
export class UploadError extends HeliosError {}

/**
 * The bytes were uploaded, but `uploads.complete` failed, so the file is still pending on the server. `fileId` is the
 * file to call `uploads.complete` again with, or `uploads.abort` to discard. The `code`, `status` and `requestId` are
 * those of the API error (`cause`).
 *
 * @example
 * try {
 *   await helios.uploads.upload(file, { contentType: "video/mp4", encode: { preset: "generic" } });
 * } catch (err) {
 *   if (err instanceof UploadCompleteError) await helios.uploads.complete(err.fileId, { store: true });
 * }
 */
export class UploadCompleteError extends HeliosError {
	/** Id of the pending file. */
	readonly fileId: string;

	/**
	 * @param fileId Id of the pending file.
	 * @param cause The error the API returned for `uploads.complete`.
	 */
	constructor(fileId: string, cause: unknown) {
		const api = cause instanceof HeliosError ? cause : undefined;
		super(api?.code ?? "upload_complete_failed", api?.message ?? "Completing the upload failed", {
			status: api?.status,
			details: api?.details,
			requestId: api?.requestId,
			cause
		});
		this.fileId = fileId;
	}
}

/**
 * A webhook delivery failed verification. The `code` says why: `signature_malformed`, `signature_mismatch`,
 * `timestamp_expired` or `payload_invalid`. `payload_invalid` also covers an event type this SDK version does not know;
 * upgrade the SDK before the server starts sending new event types.
 *
 * @example
 * try {
 *   helios.webhooks.verify(rawBody, req.headers["helios-signature"]);
 * } catch (err) {
 *   if (err instanceof WebhookError && err.code === "timestamp_expired") return res.status(400).end();
 * }
 */
export class WebhookError extends HeliosError {}
