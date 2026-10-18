import { NotFoundError } from "@helios/contracts";
import { MongoNetworkError } from "@helios/core";
import { errorResponse } from "../src/errors/errorResponse";

describe("errorResponse", () => {
	it("maps a HeliosError to its status, code and details", () => {
		const { status, body } = errorResponse(new NotFoundError("Asset gone"), "req-1");

		expect(status).toBe(404);
		expect(body).toEqual({ error: { code: "not_found", message: "Asset gone", requestId: "req-1" } });
	});

	it("maps database network failures to 503", () => {
		const { status, body } = errorResponse(new MongoNetworkError("connection refused"), "req-2");

		expect(status).toBe(503);
		expect(body.error.code).toBe("service_unavailable");
	});

	it("maps unknown failures to a 500 without leaking internals", () => {
		const { status, body } = errorResponse(new Error("password=hunter2 at /srv/secret"), "req-3");

		expect(status).toBe(500);
		expect(body.error).toEqual({ code: "internal_error", message: "Internal server error", requestId: "req-3" });
		expect(JSON.stringify(body)).not.toContain("hunter2");
	});

	it("maps an oversized body to 413", () => {
		const { status, body } = errorResponse({ status: 413, expose: true }, "req-4");

		expect(status).toBe(413);
		expect(body.error.code).toBe("payload_too_large");
	});
});
