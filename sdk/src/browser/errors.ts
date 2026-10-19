/** Context attached to a {@link BrowserUploadError}. */
export interface BrowserErrorInit {
	/** Part the failure belongs to, when there is one. */
	partNumber?: number;
	/** HTTP status returned by storage, when a response was received. */
	status?: number;
	/** The underlying error or signal reason. */
	cause?: unknown;
}

/**
 * Base class of every error thrown by the browser uploader. It carries a stable `code` and, for part failures, the
 * `partNumber` and HTTP `status`. It does not extend `HeliosError`, so the browser entry needs no server code.
 *
 * @example
 * try {
 *   await uploadParts(upload, file);
 * } catch (err) {
 *   if (err instanceof BrowserUploadError && err.code === "aborted") return;
 * }
 */
export class BrowserUploadError extends Error {
	/** Machine-readable code, such as `aborted`, `part_rejected` or `invalid_option`. */
	readonly code: string;
	/** Part the failure belongs to, when there is one. */
	readonly partNumber?: number;
	/** HTTP status returned by storage, when a response was received. */
	readonly status?: number;

	/**
	 * @param code Machine-readable error code.
	 * @param message Human-readable message.
	 * @param init Optional part number, status and cause.
	 */
	constructor(code: string, message: string, init: BrowserErrorInit = {}) {
		super(message, { cause: init.cause });
		this.name = new.target.name;
		this.code = code;
		this.partNumber = init.partNumber;
		this.status = init.status;
	}
}

/**
 * Storage answered a part upload without an `ETag` header. Browsers hide response headers unless the bucket's CORS
 * rule lists `ETag` in `ExposeHeaders`, so check the media bucket's CORS configuration.
 *
 * @example
 * if (err instanceof EtagUnavailableError) console.error("Expose ETag in the bucket CORS rule");
 */
export class EtagUnavailableError extends BrowserUploadError {
	/**
	 * @param partNumber The part whose response had no ETag.
	 */
	constructor(partNumber: number) {
		super(
			"etag_unavailable",
			`Storage did not expose an ETag for part ${partNumber}. Add ETag to the bucket CORS ExposeHeaders.`,
			{ partNumber }
		);
	}
}

/**
 * A part URL was rejected with 403 and could not be renewed, either because no `signParts` callback was given or because
 * the renewed URL was rejected too.
 *
 * @example
 * if (err instanceof PartUrlExpiredError) await restartUpload();
 */
export class PartUrlExpiredError extends BrowserUploadError {
	/**
	 * @param partNumber The part whose URL expired.
	 * @param status HTTP status returned by storage.
	 */
	constructor(partNumber: number, status: number) {
		super("part_url_expired", `The presigned URL for part ${partNumber} expired or was rejected`, {
			partNumber,
			status
		});
	}
}

/**
 * The request to storage failed before a response arrived, such as a dropped connection. Such parts are retried.
 *
 * @example
 * if (err instanceof NetworkError) console.warn("connection lost");
 */
export class NetworkError extends BrowserUploadError {
	/**
	 * @param partNumber The part being uploaded.
	 * @param cause The underlying transport error.
	 */
	constructor(partNumber: number | undefined, cause?: unknown) {
		super("network_error", "The connection to storage failed", { partNumber, cause });
	}
}

/**
 * Creates the error for an upload cancelled through its `AbortSignal`.
 *
 * @param reason The `reason` of the signal that fired.
 * @returns A `BrowserUploadError` with code `aborted`.
 */
export function abortedError(reason?: unknown): BrowserUploadError {
	return new BrowserUploadError("aborted", "The upload was aborted", { cause: reason });
}
