import { HeliosError, TooManyRequestsError, type ErrorBody } from "@helios/contracts";
import { isDatabaseUnavailableError } from "@helios/core";
import { apiConfig } from "../config";

export interface ErrorResponse {
	status: number;
	body: ErrorBody;
	retryAfterSec?: number;
}

export function errorResponse(err: unknown, requestId: string): ErrorResponse {
	if (err instanceof HeliosError) {
		return {
			...build(err.httpStatus, err.code, err.message, requestId, err.details),
			...(err instanceof TooManyRequestsError && { retryAfterSec: err.retryAfterSec })
		};
	}
	if (isDatabaseUnavailableError(err)) {
		return {
			...build(503, "service_unavailable", "Service temporarily unavailable", requestId),
			retryAfterSec: apiConfig().RETRY_AFTER_SEC
		};
	}
	if (isBodyParserError(err)) {
		return err.status === 413
			? build(413, "payload_too_large", "Request body is too large", requestId)
			: build(400, "invalid_body", "Request body could not be parsed", requestId);
	}
	return build(500, "internal_error", "Internal server error", requestId);
}

function build(status: number, code: string, message: string, requestId: string, details?: unknown): ErrorResponse {
	return {
		status,
		body: { error: { code, message, requestId, ...(details !== undefined && { details }) } }
	};
}

function isBodyParserError(err: unknown): err is { status: number } {
	return typeof err === "object" && err !== null && "expose" in err && "status" in err;
}
