import { ConfigurationError, Helios, Webhooks } from "../src/index.js";
import { Images } from "../src/images.js";
import { clientWith } from "./helpers/client.js";
import { scriptedFetch } from "./helpers/fakeFetch.js";
import { uploadsFor } from "./helpers/uploads.js";

const BASE = { apiKey: "sk_live_options", baseUrl: "https://api.test" };

function configurationErrorOf(action: () => unknown): ConfigurationError {
	try {
		action();
	} catch (err) {
		expect(err).toBeInstanceOf(ConfigurationError);
		return err as ConfigurationError;
	}
	throw new Error("expected a ConfigurationError");
}

describe("client option bounds", () => {
	it.each([
		["timeoutMs", { timeoutMs: 0 }],
		["timeoutMs", { timeoutMs: 1.5 }],
		["timeoutMs", { timeoutMs: 3_600_001 }],
		["maxRetries", { maxRetries: -1 }],
		["maxRetries", { maxRetries: 11 }],
		["maxRetries", { maxRetries: 0.5 }],
		["retryBaseDelayMs", { retryBaseDelayMs: -1 }],
		["maxRetryAfterMs", { maxRetryAfterMs: -1 }]
	])("rejects %s %j", (name, option) => {
		const error = configurationErrorOf(() => new Helios({ ...BASE, ...option }));

		expect(error.code).toBe("configuration_error");
		expect(error.message).toContain(name);
		expect(error.status).toBeUndefined();
	});

	it("accepts the bounds themselves", () => {
		expect(
			() => new Helios({ ...BASE, timeoutMs: 1, maxRetries: 0, retryBaseDelayMs: 0, maxRetryAfterMs: 0 })
		).not.toThrow();
		expect(
			() => new Helios({ ...BASE, timeoutMs: 3_600_000, maxRetries: 10, maxRetryAfterMs: 3_600_000 })
		).not.toThrow();
	});

	it("rejects an empty webhook secret at construction", () => {
		configurationErrorOf(() => new Helios({ ...BASE, webhookSecret: "" }));
	});
});

describe("upload option bounds", () => {
	it.each([
		["concurrency", { concurrency: 0 }],
		["concurrency", { concurrency: 17 }],
		["concurrency", { concurrency: 2.5 }],
		["partTimeoutMs", { partTimeoutMs: 0 }]
	])("rejects %s %j before any request", async (name, option) => {
		const scripted = scriptedFetch([]);

		const error = await uploadsFor(scripted.fetch)
			.upload(Buffer.from("abc"), { filename: "a.bin", contentType: "text/plain", store: true, ...option })
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(ConfigurationError);
		expect((error as ConfigurationError).message).toContain(name);
		expect(scripted.calls).toHaveLength(0);
	});
});

describe("webhook option bounds", () => {
	const webhooks = new Webhooks("whsec_default");

	it("rejects an empty secret passed per call", () => {
		configurationErrorOf(() => webhooks.verify("{}", "t=1,v1=00", { secret: "" }));
	});

	it.each([-1, 1.5, 86_401])("rejects toleranceSec %s", (toleranceSec) => {
		configurationErrorOf(() => webhooks.verify("{}", "t=1,v1=00", { toleranceSec }));
	});

	it("rejects an empty secret at construction", () => {
		configurationErrorOf(() => new Webhooks(""));
	});

	it("reports a missing secret as a configuration error", () => {
		configurationErrorOf(() => new Webhooks(undefined).verify("{}", "t=1,v1=00"));
	});
});

describe("image base URL", () => {
	it("rejects a missing image base URL", () => {
		configurationErrorOf(() => new Images(undefined).url("acme/media/a1/x.jpg", { w: 1 }));
	});

	it("uses the client's image base URL", () => {
		expect(
			clientWith(scriptedFetch([]).fetch, { apiKey: "sk_live_x", baseUrl: "https://api.test" }).images
		).toBeDefined();
	});
});
