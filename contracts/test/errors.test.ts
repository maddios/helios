import {
	ConflictError,
	ErrorBodySchema,
	ForbiddenError,
	HeliosError,
	NotFoundError,
	ServiceUnavailableError,
	UnauthorizedError,
	UnprocessableError,
	ValidationError
} from "../src/errors";

describe("error classes", () => {
	it.each([
		[() => new ValidationError("bad"), "ValidationError", "validation_failed", 400],
		[() => new UnauthorizedError(), "UnauthorizedError", "unauthorized", 401],
		[() => new ForbiddenError("no"), "ForbiddenError", "forbidden", 403],
		[() => new NotFoundError("missing"), "NotFoundError", "not_found", 404],
		[() => new ConflictError("dup"), "ConflictError", "conflict", 409],
		[() => new UnprocessableError("nope"), "UnprocessableError", "unprocessable", 422],
		[() => new ServiceUnavailableError("down"), "ServiceUnavailableError", "service_unavailable", 503]
	])("%#: sets name, code and httpStatus", (build, name, code, httpStatus) => {
		const error = build();
		expect(error).toBeInstanceOf(HeliosError);
		expect(error.name).toBe(name);
		expect(error.code).toBe(code);
		expect(error.httpStatus).toBe(httpStatus);
	});
});

describe("ErrorBodySchema", () => {
	it("parses an error body", () => {
		const body = { error: { code: "not_found", message: "Asset not found", requestId: "req-1" } };
		expect(ErrorBodySchema.parse(body)).toEqual(body);
	});
});
