import { AbortedError, ServiceUnavailableError, TimeoutError, ValidationError } from "../src/index.js";
import { retryAfterMs } from "../src/transport/retry.js";
import { clientWith } from "./helpers/client.js";
import { apiError, json, scriptedFetch } from "./helpers/fakeFetch.js";

const LIST_BODY = { presets: [] };

describe("retries", () => {
	it("retries a 500 and returns the next response", async () => {
		const { fetch, calls } = scriptedFetch([apiError(500, "internal_error"), json(200, LIST_BODY)]);

		await expect(clientWith(fetch).presets.list()).resolves.toEqual(LIST_BODY);
		expect(calls).toHaveLength(2);
	});

	it("waits for the Retry-After delay on a 429", async () => {
		const { fetch, calls } = scriptedFetch([
			json(429, { error: { code: "rate_limited", message: "slow down" } }, { "retry-after": "1" }),
			json(200, LIST_BODY)
		]);

		const started = Date.now();
		await clientWith(fetch).presets.list();

		expect(Date.now() - started).toBeGreaterThanOrEqual(900);
		expect(calls).toHaveLength(2);
	});

	it("retries a network failure", async () => {
		const { fetch, calls } = scriptedFetch([new TypeError("fetch failed"), json(200, LIST_BODY)]);

		await expect(clientWith(fetch).presets.list()).resolves.toEqual(LIST_BODY);
		expect(calls).toHaveLength(2);
	});

	it("does not retry a 400", async () => {
		const { fetch, calls } = scriptedFetch([apiError(400, "validation_failed"), json(200, LIST_BODY)]);

		await expect(clientWith(fetch).presets.list()).rejects.toBeInstanceOf(ValidationError);
		expect(calls).toHaveLength(1);
	});

	it("throws the last error once maxRetries is exhausted", async () => {
		const { fetch, calls } = scriptedFetch([apiError(503, "down"), apiError(503, "down"), apiError(503, "down")]);

		await expect(clientWith(fetch, { maxRetries: 2 }).presets.list()).rejects.toBeInstanceOf(ServiceUnavailableError);
		expect(calls).toHaveLength(3);
	});

	it("retries timeouts and reports a TimeoutError", async () => {
		const hangUntilTimeout = (call: { signal: AbortSignal | undefined }) =>
			new Promise<Response>((_resolve, reject) => {
				call.signal?.addEventListener("abort", () => reject(call.signal?.reason));
			});
		const { fetch, calls } = scriptedFetch([hangUntilTimeout, hangUntilTimeout]);

		const error = await clientWith(fetch, { timeoutMs: 10, maxRetries: 1 })
			.presets.list()
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(TimeoutError);
		expect(error).toMatchObject({ code: "timeout" });
		expect(calls).toHaveLength(2);
	});

	it("aborts without retrying when the caller's signal fires", async () => {
		const hangUntilAborted = (call: { signal: AbortSignal | undefined }) =>
			new Promise<Response>((_resolve, reject) => {
				call.signal?.addEventListener("abort", () => reject(call.signal?.reason));
			});
		const { fetch, calls } = scriptedFetch([hangUntilAborted, json(200, LIST_BODY)]);
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5);

		await expect(clientWith(fetch).requests.get("r1", { signal: controller.signal })).rejects.toBeInstanceOf(
			AbortedError
		);
		expect(calls).toHaveLength(1);
	});

	it("parses Retry-After seconds and HTTP dates", () => {
		expect(retryAfterMs("2", 0)).toBe(2000);
		expect(retryAfterMs(new Date(10_000).toUTCString(), 0)).toBe(10_000);
		expect(retryAfterMs(new Date(0).toUTCString(), 5_000)).toBe(0);
		expect(retryAfterMs("soon", 0)).toBeUndefined();
		expect(retryAfterMs(null, 0)).toBeUndefined();
	});
});
