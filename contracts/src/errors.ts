import { z } from "zod";

export class HeliosError extends Error {
	constructor(
		readonly code: string,
		readonly httpStatus: number,
		message: string,
		readonly details?: unknown
	) {
		super(message);
		this.name = new.target.name;
	}
}

export class ValidationError extends HeliosError {
	constructor(message: string, details?: unknown, code = "validation_failed") {
		super(code, 400, message, details);
	}
}

export class UnauthorizedError extends HeliosError {
	constructor(message = "Missing or invalid API key", details?: unknown) {
		super("unauthorized", 401, message, details);
	}
}

export class ForbiddenError extends HeliosError {
	constructor(message: string, details?: unknown) {
		super("forbidden", 403, message, details);
	}
}

export class NotFoundError extends HeliosError {
	constructor(message: string, details?: unknown) {
		super("not_found", 404, message, details);
	}
}

export class ConflictError extends HeliosError {
	constructor(message: string, details?: unknown, code = "conflict") {
		super(code, 409, message, details);
	}
}

export class UnprocessableError extends HeliosError {
	constructor(message: string, details?: unknown, code = "unprocessable") {
		super(code, 422, message, details);
	}
}

export class ServiceUnavailableError extends HeliosError {
	constructor(message: string, details?: unknown) {
		super("service_unavailable", 503, message, details);
	}
}

export const ErrorBodySchema = z
	.object({
		error: z.object({
			code: z.string().describe("Machine-readable error code"),
			message: z.string().describe("Human-readable error message"),
			details: z.unknown().optional().describe("Structured error details, e.g. zod issues"),
			requestId: z.string().optional().describe("Correlation id of the failing request")
		})
	})
	.meta({ id: "ErrorBody" });
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
