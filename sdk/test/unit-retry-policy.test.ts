import { randomUUID } from "node:crypto";
import { HeliosAdmin } from "../src/admin/client.js";
import { Helios } from "../src/client.js";
import { ApiError, ConnectionError, RateLimitError, ServiceUnavailableError, type HeliosError } from "../src/index.js";
import { clientWith } from "./helpers/client.js";
import { apiError, bodyText, json, scriptedFetch, type Responder, type ScriptedFetch } from "./helpers/fakeFetch.js";

type Mode = "idempotent" | "rateLimitOnly";
type Invoke = (helios: Helios, admin: HeliosAdmin) => Promise<unknown>;

/** Fresh responses per call: a Response body can be read only once. */
const ok = (): Response => json(200, {});
const rateLimitedFor = (seconds: string): Response =>
	json(429, { error: { code: "rate_limited", message: "slow" } }, { "retry-after": seconds });

/** Every SDK method with the retry mode it must use. A new method must be added here. */
const METHODS: [string, Mode, Invoke][] = [
	["health", "idempotent", (h) => h.health()],
	["ready", "idempotent", (h) => h.ready()],
	["openapi", "idempotent", (h) => h.openapi()],
	["encodes.create dry run", "idempotent", (h) => h.encodes.create({ source: SOURCE, preset: "p" }, { dryRun: true })],
	["encodes.create", "idempotent", (h) => h.encodes.create({ source: SOURCE, preset: "p" })],
	["encodes.reencode", "idempotent", (h) => h.encodes.reencode("a1")],
	["assets.list", "idempotent", (h) => h.assets.list()],
	["assets.get", "idempotent", (h) => h.assets.get("a1")],
	["assets.delete", "idempotent", (h) => h.assets.delete("a1")],
	["assets.transcripts", "idempotent", (h) => h.assets.transcripts("a1")],
	["assets.scenes", "idempotent", (h) => h.assets.scenes("a1")],
	["assets.setActiveStill", "rateLimitOnly", (h) => h.assets.setActiveStill("a1", 0)],
	["assets.postProcess", "idempotent", (h) => h.assets.postProcess("a1", { postProcess: {} })],
	["requests.get", "idempotent", (h) => h.requests.get("r1")],
	["requests.cancel", "idempotent", (h) => h.requests.cancel("r1")],
	["requests.callbacks.list", "idempotent", (h) => h.requests.callbacks.list("r1")],
	["requests.callbacks.redeliver", "rateLimitOnly", (h) => h.requests.callbacks.redeliver("r1")],
	[
		"uploads.create",
		"rateLimitOnly",
		(h) => h.uploads.create({ filename: "a.bin", sizeBytes: 1, contentType: "image/png" })
	],
	["uploads.complete", "idempotent", (h) => h.uploads.complete("f1", { store: true })],
	["uploads.signParts", "idempotent", (h) => h.uploads.signParts("f1", [1])],
	["uploads.listParts", "idempotent", (h) => h.uploads.listParts("f1")],
	["uploads.abort", "idempotent", (h) => h.uploads.abort("f1")],
	["files.list", "idempotent", (h) => h.files.list()],
	["files.get", "idempotent", (h) => h.files.get("f1")],
	["files.delete", "idempotent", (h) => h.files.delete("f1")],
	["files.fromUrl", "rateLimitOnly", (h) => h.files.fromUrl({ url: "https://example.test/a.png" })],
	["account.getUploadPolicy", "idempotent", (h) => h.account.getUploadPolicy()],
	[
		"account.setUploadPolicy",
		"idempotent",
		(h) => h.account.setUploadPolicy({ allowedContentTypes: ["*/*"], maxBytes: 1 })
	],
	["presets.list", "idempotent", (h) => h.presets.list()],
	["presets.get", "idempotent", (h) => h.presets.get("p")],
	["presets.create", "rateLimitOnly", (h) => h.presets.create(PRESET)],
	["presets.update", "rateLimitOnly", (h) => h.presets.update("p", { description: "d", expectedVersion: 1 })],
	["presets.delete", "idempotent", (h) => h.presets.delete("p", 1)],
	["presets.addProfile", "rateLimitOnly", (h) => h.presets.addProfile("p", { name: "x", expectedVersion: 1 } as never)],
	["presets.updateProfile", "rateLimitOnly", (h) => h.presets.updateProfile("p", "x", {} as never)],
	["presets.removeProfile", "idempotent", (h) => h.presets.removeProfile("p", "x", 1)],
	["presets.clone", "rateLimitOnly", (h) => h.presets.clone("p", "q")],
	["presets.dryRun", "rateLimitOnly", (h) => h.presets.dryRun("p", {} as never)],
	["destinations.test", "rateLimitOnly", (h) => h.destinations.test()],
	["destinations.eventBridgePolicy", "idempotent", (h) => h.destinations.eventBridgePolicy("arn")],
	["account.getDestination", "idempotent", (h) => h.account.getDestination()],
	["account.setDestination", "idempotent", (h) => h.account.setDestination(null)],
	["usage.get", "idempotent", (h) => h.usage.get({ from: "2026-10-01", to: "2026-10-02" })],
	["admin.accounts.list", "idempotent", (_h, a) => a.accounts.list()],
	["admin.accounts.create", "rateLimitOnly", (_h, a) => a.accounts.create({ slug: "s", name: "n" } as never)],
	["admin.accounts.update", "rateLimitOnly", (_h, a) => a.accounts.update("a1", {})],
	["admin.accounts.rotateWebhookSecret", "rateLimitOnly", (_h, a) => a.accounts.rotateWebhookSecret("a1")],
	["admin.keys.create", "rateLimitOnly", (_h, a) => a.keys.create("a1", { name: "k" } as never)],
	["admin.keys.revoke", "idempotent", (_h, a) => a.keys.revoke("a1", "k1")],
	["admin.destinations.test", "rateLimitOnly", (_h, a) => a.destinations.test("a1")],
	["admin.presets.list", "idempotent", (_h, a) => a.presets.list()],
	["admin.presets.get", "idempotent", (_h, a) => a.presets.get("p")],
	["admin.presets.create", "rateLimitOnly", (_h, a) => a.presets.create(PRESET)],
	["admin.presets.update", "rateLimitOnly", (_h, a) => a.presets.update("p", {} as never)],
	["admin.presets.delete", "idempotent", (_h, a) => a.presets.delete("p", 1)],
	["admin.usage.get", "idempotent", (_h, a) => a.usage.get({ from: "2026-10-01", to: "2026-10-02" })]
];

const SOURCE = { bucket: "bucket-a", key: "clip.mp4" };
const PRESET = { name: "p", description: "d", postProcess: {}, profiles: [] } as never;

function retriesOf(count: number): Response[] {
	return Array.from({ length: count }, () => apiError(500, "boom"));
}

function build(fetch: ScriptedFetch["fetch"]): { helios: Helios; admin: HeliosAdmin } {
	const options = { apiKey: "sk_live_policy", baseUrl: "https://api.test", retryBaseDelayMs: 1, fetch };
	return {
		helios: clientWith(fetch),
		admin: new HeliosAdmin({ ...options, apiKey: "sk_admin_policy" })
	};
}

async function outcome(responders: Responder[], invoke: Invoke): Promise<{ calls: number; error?: HeliosError }> {
	const scripted = scriptedFetch(responders);
	const { helios, admin } = build(scripted.fetch);
	const error = await invoke(helios, admin).then(
		() => undefined,
		(err: unknown) => err as HeliosError
	);
	return { calls: scripted.calls.length, error };
}

describe("retry policy per SDK method", () => {
	it.each(METHODS)("%s does not wait past maxRetryAfterMs for a 429", async (_name, _mode, invoke) => {
		const result = await outcome([rateLimitedFor("120"), ok()], invoke);

		expect(result.calls).toBe(1);
		expect(result.error).toBeInstanceOf(RateLimitError);
	});

	it.each(METHODS)("%s retries a 429 with a short Retry-After", async (_name, _mode, invoke) => {
		const result = await outcome([rateLimitedFor("0"), ok()], invoke);

		expect(result.calls).toBe(2);
		expect(result.error).toBeUndefined();
	});

	it.each(METHODS)("%s retries a 503 only when the mode is idempotent", async (_name, mode, invoke) => {
		const result = await outcome([apiError(503, "down"), ok()], invoke);

		if (mode === "idempotent") {
			expect(result).toEqual({ calls: 2, error: undefined });
		} else {
			expect(result.calls).toBe(1);
			expect(result.error).toBeInstanceOf(ServiceUnavailableError);
		}
	});

	it.each(METHODS)(
		"%s retries a 500 only when the mode is idempotent, up to maxRetries",
		async (_name, mode, invoke) => {
			const result = await outcome([apiError(500, "boom"), apiError(500, "boom"), ...retriesOf(3), ok()], invoke);

			expect(result.calls).toBe(mode === "idempotent" ? 4 : 1);
			expect(result.error).toBeInstanceOf(ApiError);
		}
	);

	it.each(METHODS)("%s retries a network failure only when the mode is idempotent", async (_name, mode, invoke) => {
		const result = await outcome([new TypeError("fetch failed"), ok()], invoke);

		if (mode === "idempotent") {
			expect(result).toEqual({ calls: 2, error: undefined });
		} else {
			expect(result.calls).toBe(1);
			expect(result.error).toBeInstanceOf(ConnectionError);
		}
	});
});

describe("retries of keyed creates and multipart completes", () => {
	it("reuses one requestId across retries of an encode", async () => {
		const scripted = scriptedFetch([apiError(502, "bad_gateway"), json(202, { id: "r1" })]);

		await clientWith(scripted.fetch).encodes.create({ source: SOURCE, preset: "p" });

		const ids = scripted.calls.map((call) => (call.body as { requestId?: string }).requestId);
		expect(ids[0]).toEqual(expect.any(String));
		expect(ids[1]).toBe(ids[0]);
	});

	it("retries a complete with encode with the same body, so the file's encode is not duplicated", async () => {
		const scripted = scriptedFetch([apiError(500, "boom"), json(200, { file: { id: "f1" } })]);

		await clientWith(scripted.fetch).uploads.complete("f1", { store: true });

		expect(scripted.calls.map((call) => call.body)).toEqual([{ store: true }, { store: true }]);
	});

	it("keeps a caller-supplied requestId across retries", async () => {
		const requestId = randomUUID();
		const scripted = scriptedFetch([apiError(503, "down"), json(202, { id: "r1" })]);

		await clientWith(scripted.fetch).encodes.create({ source: SOURCE, preset: "p", requestId });

		expect(scripted.calls.map((call) => (call.body as { requestId: string }).requestId)).toEqual([
			requestId,
			requestId
		]);
	});
});

describe("Retry-After cap", () => {
	it("throws RateLimitError at once when the server asks for longer than maxRetryAfterMs", async () => {
		const scripted = scriptedFetch([rateLimitedFor("120"), ok()]);

		const error = await clientWith(scripted.fetch, { maxRetryAfterMs: 1000 })
			.presets.list()
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(RateLimitError);
		expect(error).toMatchObject({ retryAfterMs: 120_000, status: 429 });
		expect(scripted.calls).toHaveLength(1);
	});

	it("waits for a Retry-After within the cap", async () => {
		const scripted = scriptedFetch([
			json(429, { error: { code: "rate_limited", message: "x" } }, { "retry-after": "1" }),
			ok()
		]);

		await clientWith(scripted.fetch, { maxRetryAfterMs: 5000 }).presets.list();

		expect(scripted.calls).toHaveLength(2);
	});
});

describe("success bodies", () => {
	it("resolves a 204 with no body", async () => {
		const scripted = scriptedFetch([new Response(null, { status: 204 })]);

		await expect(clientWith(scripted.fetch).presets.delete("p", 1)).resolves.toBeUndefined();
	});

	it("rejects a 2xx body that is not JSON as invalid_response", async () => {
		const scripted = scriptedFetch([new Response("<html>proxy</html>", { status: 200 })]);

		const error = await clientWith(scripted.fetch)
			.presets.list()
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ code: "invalid_response", status: 200 });
	});

	it("rejects an empty 200 body as invalid_response", async () => {
		const scripted = scriptedFetch([new Response(null, { status: 200 })]);

		await expect(clientWith(scripted.fetch).presets.list()).rejects.toMatchObject({ code: "invalid_response" });
	});
});
