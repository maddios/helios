import {
	ApiError,
	AuthenticationError,
	ConfigurationError,
	ConflictError,
	HeliosError,
	NotFoundError,
	PermissionError,
	RateLimitError,
	ServiceUnavailableError,
	UnprocessableError,
	ValidationError
} from "../src/index.js";
import { Helios } from "../src/client.js";
import { clientWith } from "./helpers/client.js";
import { json, scriptedFetch } from "./helpers/fakeFetch.js";

const CASES: [number, new (...args: never[]) => HeliosError][] = [
	[400, ValidationError],
	[401, AuthenticationError],
	[403, PermissionError],
	[404, NotFoundError],
	[409, ConflictError],
	[422, UnprocessableError],
	[429, RateLimitError],
	[500, ApiError],
	[503, ServiceUnavailableError]
];

describe("error mapping", () => {
	it.each(CASES)("maps HTTP %i to its error class with the server code", async (status, errorClass) => {
		const { fetch } = scriptedFetch([
			json(status, { error: { code: "some_code", message: "nope", requestId: "req-1", details: [{ path: "x" }] } })
		]);

		const error = await clientWith(fetch, { maxRetries: 0 })
			.presets.get("a")
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(errorClass);
		expect(error).toMatchObject({
			code: "some_code",
			message: "nope",
			status,
			requestId: "req-1",
			details: [{ path: "x" }]
		});
	});

	it("takes the request id from the x-request-id header when the body has none", async () => {
		const { fetch } = scriptedFetch([
			json(404, { error: { code: "not_found", message: "missing" } }, { "x-request-id": "hdr-9" })
		]);

		const error = await clientWith(fetch)
			.presets.get("a")
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(NotFoundError);
		expect(error).toMatchObject({ requestId: "hdr-9" });
	});

	it("maps a non-JSON error body by status with a generic code", async () => {
		const { fetch } = scriptedFetch([new Response("<html>bad gateway</html>", { status: 502 })]);

		const error = await clientWith(fetch, { maxRetries: 0 })
			.presets.get("a")
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ code: "http_502", status: 502 });
	});

	it("rejects an empty API key and a non-http base URL", () => {
		expect(() => new Helios({ apiKey: " ", baseUrl: "https://api.test" })).toThrow(ConfigurationError);
		expect(() => new Helios({ apiKey: "k", baseUrl: "ftp://api.test" })).toThrow(ConfigurationError);
		expect(() => new Helios({ apiKey: "k", baseUrl: "not a url" })).toThrow(ConfigurationError);
	});

	it("strips a trailing slash from the base URL", async () => {
		const { fetch, calls } = scriptedFetch([json(200, { status: "ok" })]);

		await new Helios({ apiKey: "k", baseUrl: "https://api.test/v1///", fetch }).health();

		expect(calls[0]?.url).toBe("https://api.test/v1/health");
	});
});
