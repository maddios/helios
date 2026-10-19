import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ensureIndexes, genericPreset, getAccount } from "@helios/core";
import { HeliosAdmin } from "../src/admin/client.js";
import { Helios } from "../src/client.js";
import {
	AuthenticationError,
	ConflictError,
	NotFoundError,
	PermissionError,
	TimeoutError,
	UploadError,
	ValidationError,
	type ProfileInput
} from "../src/index.js";
import { createApp } from "../../api/src/app.js";
import { mockObjectStore } from "../../api/test/helpers/apiMocks.js";
import { seedAccount, seedAdminKey, seedAsset, seedGenericPreset } from "../../api/test/helpers/fixtures.js";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo.js";
import { videoSource } from "../../core/test/helpers/pipelineFixtures.js";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));

process.env.SSRF_ALLOWED_HOSTS = "127.0.0.1";

const BUCKET = "bucket-a";
const SIGNED_HOST = "https://signed.test";
const ARN = "arn:aws:events:us-east-2:123456789012:event-bus/bella";
const PROFILES = genericPreset.profiles.map(({ version: _version, ...profile }) => profile);
const PRESET_BODY = {
	name: "mine",
	description: "Account preset",
	postProcess: genericPreset.postProcess,
	profiles: PROFILES
};
const MB = 1024 * 1024;

interface Delivery {
	headers: IncomingHttpHeaders;
	body: string;
}

let server: Server;
let baseUrl: string;
let sink: Server;
let sinkUrl: string;
let deliveries: Delivery[];
let s3Puts: { url: string; bytes: Buffer }[];
let key: string;
let accountId: string;
let adminKey: string;
let helios: Helios;

const realFetch = globalThis.fetch;

beforeAll(async () => {
	await startMongo();
	server = createApp().listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", () => resolve()));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	sink = createServer((req, res) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk: string) => (body += chunk));
		req.on("end", () => {
			deliveries.push({ headers: req.headers, body });
			res.writeHead(200).end();
		});
	});
	await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", () => resolve()));
	sinkUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/hook`;
});

afterAll(async () => {
	server.closeAllConnections();
	sink.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
	await new Promise((resolve) => sink.close(resolve));
	await stopMongo();
});

beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	mockObjectStore();
	deliveries = [];
	s3Puts = [];
	({ key, accountId } = await seedAccount());
	adminKey = await seedAdminKey();
	helios = new Helios({
		apiKey: key,
		baseUrl,
		imageBaseUrl: "https://img.test.invalid",
		fetch: fetchWithStorage
	});
});

/** Serves presigned storage URLs in memory and sends every other request to the in-process API. */
const fetchWithStorage: typeof fetch = async (input, init) => {
	const url = String(input);
	if (!url.startsWith(SIGNED_HOST)) {
		return realFetch(input, init);
	}
	const body = init?.body instanceof Uint8Array ? Buffer.from(init.body) : Buffer.alloc(0);
	s3Puts.push({ url, bytes: body });
	return new Response(null, { status: 200, headers: { etag: `"etag-${s3Puts.length}"` } });
};

async function webhookSecretOf(id: string): Promise<string> {
	return (await getAccount(id)).webhookSecret;
}

function admin(): HeliosAdmin {
	return new HeliosAdmin({ apiKey: adminKey, baseUrl, fetch: fetchWithStorage });
}

async function failureOf(action: Promise<unknown>): Promise<unknown> {
	return action.then(
		() => {
			throw new Error("expected the call to fail");
		},
		(err: unknown) => err
	);
}

describe("health", () => {
	it("reports liveness, readiness and the OpenAPI document", async () => {
		await expect(helios.health()).resolves.toEqual({ status: "ok" });
		await expect(helios.ready()).resolves.toEqual({ status: "ready" });
		await expect(helios.openapi()).resolves.toMatchObject({ openapi: "3.0.3" });
	});
});

describe("presets", () => {
	it("creates, reads, lists and updates an account preset", async () => {
		const created = await helios.presets.create(PRESET_BODY);
		const fetched = await helios.presets.get("mine");
		const listed = await helios.presets.list();
		const updated = await helios.presets.update("mine", { expectedVersion: 1, description: "Renamed" });

		expect(created).toMatchObject({ name: "mine", version: 1, scope: "account" });
		expect(fetched.name).toBe("mine");
		expect(listed.presets.map((preset) => preset.name)).toEqual(expect.arrayContaining(["generic", "mine"]));
		expect(updated).toMatchObject({ version: 2, description: "Renamed" });
	});

	it("adds, updates and removes profiles, returning 409 on a duplicate or stale version", async () => {
		await helios.presets.create(PRESET_BODY);
		const base = PROFILES.find((profile) => profile.type === "video" && !profile.isDefault);
		if (base === undefined) {
			throw new Error("the generic preset has no non-default video profile");
		}
		const extra: ProfileInput = { ...base, name: "extra" };

		const added = await helios.presets.addProfile("mine", { expectedVersion: 1, profile: extra });
		const duplicate = await failureOf(
			helios.presets.addProfile("mine", { expectedVersion: added.version, profile: extra })
		);
		const stale = await failureOf(helios.presets.updateProfile("mine", "extra", { expectedVersion: 1, priority: 9 }));
		const patched = await helios.presets.updateProfile("mine", "extra", {
			expectedVersion: added.version,
			priority: 9
		});
		const removed = await helios.presets.removeProfile("mine", "extra", patched.version);

		expect(added.profiles.map((profile) => profile.name)).toContain("extra");
		expect(duplicate).toBeInstanceOf(ValidationError);
		expect(stale).toBeInstanceOf(ConflictError);
		expect(patched.profiles.find((profile) => profile.name === "extra")?.priority).toBe(9);
		expect(removed.profiles.map((profile) => profile.name)).not.toContain("extra");
	});

	it("clones a system preset, plans a dry run and deletes with expectedVersion", async () => {
		const bella = await helios.presets.clone("generic", "bella");
		const plan = await helios.presets.dryRun("bella", { sourceMetadata: videoSource });
		await helios.presets.delete("bella", bella.version);

		expect(bella).toMatchObject({ name: "bella", scope: "account" });
		expect(plan.items.length).toBeGreaterThan(0);
		await expect(helios.presets.get("bella")).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe("encodes", () => {
	it("plans an encode with dryRun", async () => {
		const plan = await helios.encodes.create(
			{ source: { bucket: BUCKET, key: "clips/a.mp4" }, preset: "generic", sourceMetadata: videoSource },
			{ dryRun: true }
		);

		expect(plan.items.length).toBeGreaterThan(0);
		expect(plan.items[0]).toMatchObject({ kind: "encode", status: expect.any(String) });
	});

	it("creates an async encode and returns the request in ANALYZING", async () => {
		const request = await helios.encodes.create({ source: { bucket: BUCKET, key: "clips/a.mp4" }, preset: "generic" });

		expect(request).toMatchObject({ mode: "encode", status: "ANALYZING" });
		expect(request.assetId).toEqual(expect.any(String));
	});

	it("re-encodes an existing asset with a new request", async () => {
		const asset = await seedAsset(accountId);

		const request = await helios.encodes.reencode(asset._id, { refreshPreset: false });

		expect(request).toMatchObject({ mode: "reencode", assetId: asset._id });
	});
});

describe("requests", () => {
	it("gets, cancels and waits for a request", async () => {
		const created = await helios.encodes.create({ source: { bucket: BUCKET, key: "clips/a.mp4" }, preset: "generic" });

		const fetched = await helios.requests.get(created.id);
		const cancelled = await helios.requests.cancel(created.id);
		const settled = await helios.requests.wait(created.id, { intervalMs: 1 });

		expect(fetched.id).toBe(created.id);
		expect(cancelled.status).toBe("CANCELLED");
		expect(settled.status).toBe("CANCELLED");
	});

	it("times out waiting for a request that keeps running", async () => {
		const created = await helios.encodes.create({ source: { bucket: BUCKET, key: "clips/b.mp4" }, preset: "generic" });

		await expect(helios.requests.wait(created.id, { timeoutMs: 20, intervalMs: 1 })).rejects.toBeInstanceOf(
			TimeoutError
		);
	});

	it("lists callback deliveries and rejects redelivery of an unfinished request", async () => {
		const created = await helios.encodes.create({ source: { bucket: BUCKET, key: "clips/c.mp4" }, preset: "generic" });

		const { deliveries: list } = await helios.requests.callbacks.list(created.id);
		const redeliver = await failureOf(helios.requests.callbacks.redeliver(created.id));

		expect(list).toEqual([]);
		expect(redeliver).toBeInstanceOf(ConflictError);
	});
});

describe("assets", () => {
	it("gets, lists and filters assets", async () => {
		const asset = await seedAsset(accountId, { externalId: "clip-7" });

		const fetched = await helios.assets.get(asset._id);
		const listed = await helios.assets.list();
		const filtered = await helios.assets.list({ externalId: "clip-7" });

		expect(fetched.id).toBe(asset._id);
		expect(listed.assets.map((item) => item.id)).toContain(asset._id);
		expect(filtered.assets.map((item) => item.id)).toEqual([asset._id]);
	});

	it("reads transcripts and reports missing scene analysis as not found", async () => {
		const asset = await seedAsset(accountId);

		await expect(helios.assets.transcripts(asset._id)).resolves.toEqual({ transcripts: [] });
		await expect(helios.assets.scenes(asset._id)).rejects.toBeInstanceOf(NotFoundError);
	});

	it("rejects selecting a still index that the asset does not have", async () => {
		const asset = await seedAsset(accountId);

		await expect(helios.assets.setActiveStill(asset._id, 0)).rejects.toBeInstanceOf(ValidationError);
	});

	it("starts post-processing on an existing asset", async () => {
		const asset = await seedAsset(accountId);

		const request = await helios.assets.postProcess(asset._id, { postProcess: { sceneDetection: true } });

		expect(request).toMatchObject({ mode: "postProcess", assetId: asset._id });
	});

	it("deletes an asset, after which it is not found", async () => {
		const asset = await seedAsset(accountId);

		await expect(helios.assets.delete(asset._id)).resolves.toEqual({ assetId: asset._id });
		await expect(helios.assets.get(asset._id)).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe("uploads", () => {
	it("presigns a single upload", async () => {
		const presigned = await helios.uploads.presign({ filename: "a.jpg", sizeBytes: 3, contentType: "image/jpeg" });

		expect(presigned).toMatchObject({ uploadKey: expect.any(String), url: `${SIGNED_HOST}/put` });
	});

	it("uploads a small buffer with one presigned PUT", async () => {
		const uploadKey = await helios.uploads.upload(Buffer.from("abc"), { filename: "a.txt", contentType: "text/plain" });

		expect(uploadKey).toEqual(expect.any(String));
		expect(s3Puts).toEqual([{ url: `${SIGNED_HOST}/put`, bytes: Buffer.from("abc") }]);
	});

	it("creates and completes a multipart upload by hand", async () => {
		const created = await helios.uploads.createMultipart({ filename: "big.mp4", sizeBytes: 12 * MB });
		const completed = await helios.uploads.completeMultipart(created.uploadId, {
			uploadKey: created.uploadKey,
			parts: created.parts.map((part) => ({ partNumber: part.partNumber, etag: `"e${part.partNumber}"` }))
		});

		expect(created.parts).toHaveLength(3);
		expect(created.partSizeBytes).toBe(5 * MB);
		expect(completed.uploadKey).toBe(created.uploadKey);
	});

	it("uploads a large input through multipart and encodes it", async () => {
		const bytes = Buffer.alloc(12 * MB, 7);

		const result = await helios.uploads.uploadAndEncode(bytes, {
			filename: "big.mp4",
			preset: "generic",
			multipartThresholdBytes: MB
		});

		expect(result.request).toMatchObject({ status: "ANALYZING" });
		expect(s3Puts.map((put) => put.bytes.byteLength)).toEqual([5 * MB, 5 * MB, 2 * MB]);
	});

	it("uploads and encodes a small input in one call", async () => {
		const result = await helios.uploads.uploadAndEncode(Buffer.from("abc"), { filename: "a.mp4", preset: "generic" });

		expect(result.uploadKey).toEqual(expect.any(String));
		expect(result.request).toMatchObject({ mode: "encode", status: "ANALYZING" });
	});

	it("aborts a multipart upload", async () => {
		const created = await helios.uploads.createMultipart({ filename: "big.mp4", sizeBytes: 12 * MB });

		await expect(helios.uploads.abortMultipart(created.uploadId, created.uploadKey)).resolves.toBeUndefined();
	});

	it("rejects an upload whose storage PUT fails", async () => {
		const failing = new Helios({
			apiKey: key,
			baseUrl,
			fetch: async (input, init) =>
				String(input).startsWith(SIGNED_HOST) ? new Response("denied", { status: 403 }) : realFetch(input, init)
		});

		await expect(failing.uploads.upload(Buffer.from("abc"), { filename: "a.txt" })).rejects.toBeInstanceOf(UploadError);
	});

	it("presigns a raw file", async () => {
		const file = await helios.files.create({ filename: "brief.pdf", contentType: "application/pdf" });

		expect(file).toMatchObject({ fileKey: expect.any(String), uploadUrl: expect.any(String), url: expect.any(String) });
	});
});

describe("usage", () => {
	it("returns the account usage for a date range", async () => {
		const usage = await helios.usage.get({ from: "2026-10-01", to: "2026-10-07" });

		expect(usage).toMatchObject({ from: "2026-10-01", to: "2026-10-07", requests: 0 });
	});
});

describe("destinations and webhooks", () => {
	it("sets the account destination, tests it and verifies the signed test event", async () => {
		await helios.account.setDestination({ type: "webhook", url: sinkUrl });

		const result = await helios.destinations.test();
		const [delivery] = deliveries;
		const secret = await webhookSecretOf(accountId);
		const signature = delivery?.headers["helios-signature"];
		const event = helios.webhooks.verify(delivery?.body ?? "", typeof signature === "string" ? signature : undefined, {
			secret
		});

		expect(result).toEqual({ ok: true, httpStatus: 200 });
		expect(event).toMatchObject({ event: "helios.test", data: { accountId } });
	});

	it("gets and clears the account destination", async () => {
		expect(await helios.account.getDestination()).toEqual({ destination: null });

		await helios.account.setDestination({ type: "webhook", url: sinkUrl });
		const set = await helios.account.getDestination();
		await helios.account.setDestination(null);

		expect(set.destination).toEqual({ type: "webhook", url: sinkUrl });
		expect(await helios.account.getDestination()).toEqual({ destination: null });
	});

	it("tests a destination passed explicitly", async () => {
		const result = await helios.destinations.test({ type: "webhook", url: sinkUrl });

		expect(result.ok).toBe(true);
		expect(deliveries).toHaveLength(1);
	});

	it("reports a failed delivery in the result without throwing", async () => {
		const result = await helios.destinations.test({ type: "webhook", url: "http://127.0.0.1:9/unused" });

		expect(result.ok).toBe(false);
		expect(result.error).toMatchObject({ code: expect.any(String), hint: expect.any(String) });
	});

	it("returns the EventBridge policy for a bus", async () => {
		const policy = await helios.destinations.eventBridgePolicy(ARN);

		expect(policy.command).toContain("--event-bus-name bella");
		expect(policy.policy.Version).toBe("2012-10-17");
	});
});

describe("admin", () => {
	it("creates, lists, updates and rotates an account", async () => {
		const created = await admin().accounts.create({ slug: "novel", name: "Novel", sourceBuckets: ["novel-src"] });
		const listed = await admin().accounts.list();
		const updated = await admin().accounts.update(created.id, { name: "Novel Two" });
		const rotated = await admin().accounts.rotateWebhookSecret(created.id);

		expect(created.webhookSecret).toEqual(expect.any(String));
		expect(listed.accounts.map((account) => account.slug)).toEqual(expect.arrayContaining(["acme", "novel"]));
		expect(updated.name).toBe("Novel Two");
		expect(rotated.webhookSecret).not.toBe(created.webhookSecret);
	});

	it("issues a usable key and revokes it", async () => {
		const created = await admin().accounts.create({ slug: "keyed", name: "Keyed", sourceBuckets: [] });
		const issued = await admin().keys.create(created.id, { name: "ci" });
		const usingKey = new Helios({ apiKey: issued.key, baseUrl });

		await expect(usingKey.usage.get({ from: "2026-10-01", to: "2026-10-01" })).resolves.toMatchObject({ requests: 0 });
		await admin().keys.revoke(created.id, issued.id);
		await expect(usingKey.usage.get({ from: "2026-10-01", to: "2026-10-01" })).rejects.toBeInstanceOf(
			AuthenticationError
		);
	});

	it("manages system presets", async () => {
		const created = await admin().presets.create({ ...PRESET_BODY, name: "social" });
		const fetched = await admin().presets.get("social");
		const updated = await admin().presets.update("social", { expectedVersion: created.version, description: "Cuts" });
		await admin().presets.delete("social", updated.version);

		expect(fetched.scope).toBe("system");
		expect(updated.version).toBe(created.version + 1);
		expect((await admin().presets.list()).presets.map((preset) => preset.name)).not.toContain("social");
	});

	it("reads usage across accounts and tests an account destination", async () => {
		const usage = await admin().usage.get({ from: "2026-10-01", to: "2026-10-07" });
		const result = await admin().destinations.test(accountId, { type: "webhook", url: sinkUrl });

		expect(usage.accounts.map((account) => account.accountId)).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it("refuses admin calls made with an account key", async () => {
		const wrong = new HeliosAdmin({ apiKey: key, baseUrl });

		await expect(wrong.accounts.list()).rejects.toBeInstanceOf(PermissionError);
	});
});
