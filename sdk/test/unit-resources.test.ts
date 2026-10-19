import { Helios } from "../src/client.js";
import { HeliosAdmin } from "../src/admin/client.js";
import { clientWith } from "./helpers/client.js";
import { json, scriptedFetch, type Call } from "./helpers/fakeFetch.js";
import { requestView } from "./helpers/fixtures.js";

const ARN = "arn:aws:events:us-east-2:123456789012:event-bus/bella";

type Invoke = (helios: Helios) => Promise<unknown>;

const ROUTES: [string, Invoke, string, string][] = [
	["presets.get encodes the name", (h) => h.presets.get("my preset"), "GET", "/presets/my%20preset"],
	["presets.delete sends expectedVersion", (h) => h.presets.delete("p", 3), "DELETE", "/presets/p?expectedVersion=3"],
	[
		"presets.removeProfile sends expectedVersion",
		(h) => h.presets.removeProfile("p", "720p", 4),
		"DELETE",
		"/presets/p/profiles/720p?expectedVersion=4"
	],
	["presets.clone posts to the source", (h) => h.presets.clone("generic", "bella"), "POST", "/presets/generic/clone"],
	["presets.dryRun posts the plan", (h) => h.presets.dryRun("p", { assetId: "a1" }), "POST", "/presets/p/dry-run"],
	[
		"assets.list passes the query",
		(h) => h.assets.list({ externalId: "x", limit: 5 }),
		"GET",
		"/assets?externalId=x&limit=5"
	],
	["assets.get", (h) => h.assets.get("a1"), "GET", "/assets/a1"],
	["assets.delete", (h) => h.assets.delete("a1"), "DELETE", "/assets/a1"],
	["assets.transcripts", (h) => h.assets.transcripts("a1"), "GET", "/assets/a1/transcripts"],
	["assets.scenes", (h) => h.assets.scenes("a1"), "GET", "/assets/a1/scenes"],
	["assets.setActiveStill", (h) => h.assets.setActiveStill("a1", 2), "PATCH", "/assets/a1/active-still"],
	["requests.get", (h) => h.requests.get("r1"), "GET", "/requests/r1"],
	["requests.cancel", (h) => h.requests.cancel("r1"), "DELETE", "/requests/r1"],
	["requests.callbacks.list", (h) => h.requests.callbacks.list("r1"), "GET", "/requests/r1/callbacks"],
	[
		"requests.callbacks.redeliver",
		(h) => h.requests.callbacks.redeliver("r1"),
		"POST",
		"/requests/r1/callbacks/redeliver"
	],
	["uploads.presign", (h) => h.uploads.presign({ filename: "a.jpg", sizeBytes: 1 }), "POST", "/uploads/presigned"],
	[
		"uploads.createMultipart",
		(h) => h.uploads.createMultipart({ filename: "a.mp4", sizeBytes: 1 }),
		"POST",
		"/uploads/multipart"
	],
	[
		"uploads.abortMultipart encodes the key",
		(h) => h.uploads.abortMultipart("u1", "uploads/a/b.mp4"),
		"DELETE",
		"/uploads/multipart/u1?uploadKey=uploads%2Fa%2Fb.mp4"
	],
	["files.create", (h) => h.files.create({ filename: "brief.pdf" }), "POST", "/files"],
	["account.getDestination", (h) => h.account.getDestination(), "GET", "/account/destination"],
	["account.setDestination", (h) => h.account.setDestination(null), "PUT", "/account/destination"],
	["destinations.test", (h) => h.destinations.test(), "POST", "/destinations/test"],
	[
		"destinations.eventBridgePolicy encodes the bus ARN",
		(h) => h.destinations.eventBridgePolicy(ARN),
		"GET",
		`/destinations/eventbridge/policy?eventBusArn=${encodeURIComponent(ARN)}`
	],
	[
		"usage.get passes the range",
		(h) => h.usage.get({ from: "2026-10-01", to: "2026-10-31" }),
		"GET",
		"/usage?from=2026-10-01&to=2026-10-31"
	],
	["health", (h) => h.health(), "GET", "/health"],
	["ready", (h) => h.ready(), "GET", "/ready"],
	["openapi", (h) => h.openapi(), "GET", "/openapi.json"]
];

describe("resource routes", () => {
	it.each(ROUTES)("%s calls %s %s", async (_name, invoke, method, path) => {
		const { fetch, calls } = scriptedFetch([json(200, {})]);

		await invoke(clientWith(fetch)).catch(() => undefined);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method, url: `https://api.test${path}` });
	});

	it("sends the bearer key on every request", async () => {
		const { fetch, calls } = scriptedFetch([json(200, { status: "ok" })]);

		await clientWith(fetch).health();

		expect(calls[0]?.headers.authorization).toBe("Bearer sk_live_test");
	});

	it("posts the reencode body with a requestId", async () => {
		const { fetch, calls } = scriptedFetch([json(202, requestView("ANALYZING"))]);

		await clientWith(fetch).encodes.reencode("a1", { refreshPreset: true });

		expect(calls[0]?.body).toMatchObject({ refreshPreset: true, requestId: expect.any(String) });
	});

	it("sets only the destination field on the account destination PUT", async () => {
		const { fetch, calls } = scriptedFetch([json(200, { destination: null })]);

		await clientWith(fetch).account.setDestination(null);

		expect(calls[0]?.body).toEqual({ destination: null });
	});

	it("posts the test destination as an empty body when none is given", async () => {
		const { fetch, calls } = scriptedFetch([json(200, { ok: true })]);

		await clientWith(fetch).destinations.test();

		expect(calls[0]?.body).toEqual({});
	});

	it("sends the admin entry point to /admin paths only", async () => {
		const { fetch, calls } = scriptedFetch([json(200, { presets: [] })]);

		await new HeliosAdmin({ apiKey: "sk_admin_x", baseUrl: "https://api.test", fetch }).presets.list();

		expect(calls[0]).toMatchObject({ method: "GET", url: "https://api.test/admin/presets" });
		expect((calls[0] as Call).headers.authorization).toBe("Bearer sk_admin_x");
	});
});
