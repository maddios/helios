import { ErrorBodySchema } from "@helios/contracts";
import {
	ApiError,
	AuthenticationError,
	ConflictError,
	HeliosError,
	NotFoundError,
	PermissionError,
	RateLimitError,
	ServiceUnavailableError,
	UnprocessableError,
	ValidationError,
	type ErrorInit
} from "../errors.js";
import { retryAfterMs } from "./retry.js";

type ErrorConstructor = new (code: string, message: string, init: ErrorInit & { retryAfterMs?: number }) => HeliosError;

const BY_STATUS: Partial<Record<number, ErrorConstructor>> = {
	400: ValidationError,
	401: AuthenticationError,
	403: PermissionError,
	404: NotFoundError,
	409: ConflictError,
	422: UnprocessableError,
	429: RateLimitError,
	503: ServiceUnavailableError
};

/**
 * Converts an error response into the matching {@link HeliosError} subclass.
 *
 * The body is expected to match the API error envelope `{ error: { code, message, details, requestId } }`. A body that
 * does not match (for example an HTML proxy page) still maps by status, with a generic `http_<status>` code.
 *
 * @param status HTTP status of the response.
 * @param body Parsed JSON body, or `undefined` when the body was not JSON.
 * @param headers Response headers, read for `x-request-id` and `Retry-After`.
 * @returns The error to throw.
 */
export function errorFromResponse(status: number, body: unknown, headers: Headers): HeliosError {
	const envelope = ErrorBodySchema.safeParse(body);
	const error = envelope.success ? envelope.data.error : undefined;
	const ErrorClass = BY_STATUS[status] ?? ApiError;
	return new ErrorClass(error?.code ?? `http_${status}`, error?.message ?? `Request failed with status ${status}`, {
		status,
		details: error?.details,
		requestId: error?.requestId ?? headers.get("x-request-id") ?? undefined,
		retryAfterMs: retryAfterMs(headers.get("retry-after"))
	});
}
