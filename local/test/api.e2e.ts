import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import OpenAPIParser from "@readme/openapi-parser";
import {
	analyzeRequest,
	genericPreset,
	seedSystemPreset,
	apiKeys,
	closeDb,
	createApiKey,
	ensureIndexes,
	initDb,
	jobReports,
	mediaAssets,
	objectStore,
	pipelineItems,
	queueFor,
	requests,
	usageDaily,
	callbackDeliveries,
	accounts,
	encodingPresets,
	sceneAnalyses,
	transcripts,
	type AnalyzeMessage
} from "@helios/core";
import { createApp } from "../../api/src/app";
import { bootstrap } from "../bootstrap";
import { FIXTURE_DIR, generateFixtures } from "../fixtures";
import { loadLocalConfig } from "../loadConfig";
import { drainOnce } from "./drain";

const local = loadLocalConfig();
const DEADLINE_MS = 180000;
const TEST_TIMEOUT_MS = 200000;
const FIXTURE = "h1080_16x9.mp4";
const POST_PROCESS_OFF = { transcribe: false, sceneDetection: false } as const;
const suffix = randomUUID().slice(0, 8);
const slug = `e2e-api-${suffix}`;
const s3 = new S3Client({ region: local.awsRegion, endpoint: local.awsEndpoint, forcePathStyle: true });
const sourceKeys: string[] = [];

let server: Server | undefined;
let base = "";
let adminKey = "";
let adminKeyId = "";
let accountId = "";
let accountKey = "";
let accountKeyId = "";
let syncRequestId = "";
let asyncRequestId = "";
let asyncAssetId = "";

async function call(method: string, urlPath: string, options: { key?: string; body?: unknown } = {}) {
	const res = await fetch(`${base}${urlPath}`, {
		method,
		headers: {
			...(options.key !== undefined && { authorization: `Bearer ${options.key}` }),
			...(options.body !== undefined && { "content-type": "application/json" })
		},
		...(options.body !== undefined && { body: JSON.stringify(options.body) })
	});
	const text = await res.text();
	return { status: res.status, body: text.length > 0 ? (JSON.parse(text) as Record<string, any>) : undefined };
}

const admin = (method: string, urlPath: string, body?: unknown) => call(method, urlPath, { key: adminKey, body });
const account = (method: string, urlPath: string, body?: unknown) => call(method, urlPath, { key: accountKey, body });

async function requestStatus(id: string): Promise<string | undefined> {
	return (await requests().findOne({ _id: id }))?.status;
}

async function drainAnalyze(): Promise<void> {
	const queue = queueFor<AnalyzeMessage>("analyze");
	for (const message of await queue.poll(10, 1)) {
		if ((await requests().countDocuments({ _id: message.body.requestId }, { limit: 1 })) === 1) {
			await analyzeRequest(message.body.requestId);
		}
		await queue.ack(message);
	}
}

async function drainUntil(done: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + DEADLINE_MS;
	while (!(await done())) {
		if (Date.now() > deadline) {
			throw new Error("API e2e drain deadline exceeded");
		}
		await drainAnalyze();
		await drainOnce();
	}
}

async function openTemporaryAdminKey(): Promise<void> {
	const { key, record } = await createApiKey({ scope: "admin", name: `e2e-${suffix}` });
	adminKey = key;
	adminKeyId = record._id;
}

async function uploadSource(name: string): Promise<string> {
	const key = `e2e-api/${slug}/${name}`;
	const body = fs.readFileSync(path.join(FIXTURE_DIR, name));
	await s3.send(new PutObjectCommand({ Bucket: local.sourceBucket, Key: key, Body: body }));
	sourceKeys.push(key);
	return key;
}

beforeAll(async () => {
	generateFixtures();
	await bootstrap(local.e2eQueuePrefix, [local.mediaBucket, local.sourceBucket], local.worker.visibilityExtensionSec);
	await initDb(local.mongoUri);
	await ensureIndexes();
	await seedSystemPreset(genericPreset);
	await openTemporaryAdminKey();
	server = createApp().listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	const created = await admin("POST", "/admin/accounts", {
		slug,
		name: "E2E API",
		sourceBuckets: [local.sourceBucket],
		features: { peopleAttributes: false }
	});
	accountId = created.body?.id;
	const issued = await admin("POST", `/admin/accounts/${accountId}/keys`, { name: "e2e" });
	accountKey = issued.body?.key;
	accountKeyId = issued.body?.id;
});

afterAll(async () => {
	await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
	await Promise.all([
		mediaAssets().deleteMany({ accountId }),
		requests().deleteMany({ accountId }),
		pipelineItems().deleteMany({ accountId }),
		jobReports().deleteMany({ accountId }),
		usageDaily().deleteMany({ accountId }),
		callbackDeliveries().deleteMany({ accountId }),
		apiKeys().deleteMany({ accountId }),
		encodingPresets().deleteMany({ accountId }),
		transcripts().deleteMany({ accountId }),
		sceneAnalyses().deleteMany({ accountId }),
		accounts().deleteMany({ _id: accountId }),
		apiKeys().deleteOne({ _id: adminKeyId })
	]);
	await objectStore().deleteKeys(await objectStore().listKeys(`${slug}/`));
	if (sourceKeys.length > 0) {
		await s3.send(
			new DeleteObjectsCommand({ Bucket: local.sourceBucket, Delete: { Objects: sourceKeys.map((Key) => ({ Key })) } })
		);
	}
	await closeDb();
});

describe("Helios API against LocalStack and Mongo", () => {
	it("reports health and serves a valid OpenAPI document", async () => {
		const health = await call("GET", "/health");
		const openApi = await fetch(`${base}/openapi.json`, {
			headers: { authorization: `Bearer ${accountKey}` }
		}).then((res) => res.text());

		expect(health.body).toEqual({ status: "ok" });
		expect((await call("GET", "/ready")).body).toEqual({ status: "ready" });
		await expect(OpenAPIParser.validate(JSON.parse(openApi))).resolves.toBeDefined();
		expect(accountKeyId).not.toBe("");
	});

	it(
		"uploads a fixture through a presigned PUT and encodes it synchronously (201)",
		async () => {
			const body = fs.readFileSync(path.join(FIXTURE_DIR, FIXTURE));
			const presigned = await account("POST", "/uploads/presigned", {
				filename: FIXTURE,
				sizeBytes: body.length
			});
			const put = await fetch(presigned.body?.url, { method: "PUT", body });

			const sync = await account("POST", "/encode", {
				source: { uploadKey: presigned.body?.uploadKey },
				preset: "generic",
				postProcess: POST_PROCESS_OFF,
				analyze: "sync"
			});

			expect(put.status).toBe(200);
			expect(sync.status).toBe(201);
			expect(sync.body).toMatchObject({ mode: "encode", status: "IN_PROGRESS" });
			expect(sync.body?.items.length).toBeGreaterThan(0);
			syncRequestId = sync.body?.id;
			await drainUntil(async () => (await requestStatus(syncRequestId)) === "COMPLETE");
			expect(await requestStatus(syncRequestId)).toBe("COMPLETE");
		},
		TEST_TIMEOUT_MS
	);

	it(
		"encodes an s3 source asynchronously (202) and returns outputs with CDN urls",
		async () => {
			const key = await uploadSource(FIXTURE);
			const created = await account("POST", "/encode", {
				source: { bucket: local.sourceBucket, key },
				preset: "generic",
				postProcess: POST_PROCESS_OFF,
				analyze: "async",
				externalId: `ext-${suffix}`
			});
			asyncRequestId = created.body?.id;
			await drainUntil(async () => ["COMPLETE", "ERROR"].includes((await requestStatus(asyncRequestId)) ?? ""));

			const request = await account("GET", `/requests/${asyncRequestId}`);
			const assets = await account("GET", `/assets?externalId=ext-${suffix}`);
			asyncAssetId = assets.body?.assets[0]?.id;
			const asset = await account("GET", `/assets/${asyncAssetId}`);

			expect(created.status).toBe(202);
			expect(created.body?.status).toBe("ANALYZING");
			expect(request.body).toMatchObject({ status: "COMPLETE", progress: { pending: 0 } });
			expect(assets.body?.assets).toHaveLength(1);
			const outputs = Object.values(asset.body?.outputs ?? {}) as { url?: string; items?: { url: string }[] }[];
			expect(outputs.length).toBeGreaterThan(0);
			const urls = outputs.flatMap((output) => [output.url, ...(output.items ?? []).map((item) => item.url)]);
			expect(urls.filter((url) => url !== undefined)).not.toHaveLength(0);
			for (const url of urls.filter((url) => url !== undefined)) {
				expect(url.startsWith(`${local.cdnBaseUrl}/`)).toBe(true);
				expect(url).toContain("?v=1");
			}
		},
		TEST_TIMEOUT_MS
	);

	it("repeats an encode by requestId with 200 and the same request", async () => {
		const requestId = randomUUID();
		const body = {
			source: { bucket: local.sourceBucket, key: await uploadSource(FIXTURE) },
			preset: "generic",
			postProcess: POST_PROCESS_OFF,
			requestId
		};
		const first = await account("POST", "/encode", { ...body, analyze: "async" });
		const again = await account("POST", "/encode", { ...body, analyze: "async" });

		expect(first.status).toBe(202);
		expect(again.status).toBe(200);
		expect(again.body?.id).toBe(first.body?.id);
	});

	it("manages presets with profile sub-routes, versions and 409 conflicts", async () => {
		const name = `e2e-${suffix}`;
		const generic = await account("GET", "/presets/generic");
		const profiles = generic.body?.profiles.map(({ version: _v, ...profile }: Record<string, unknown>) => profile);
		expect(generic.status).toBe(200);

		const created = await account("POST", "/presets", {
			name,
			description: "E2E preset",
			postProcess: generic.body?.postProcess,
			profiles
		});
		const extra = {
			...profiles.find((p: { type: string; isDefault: boolean }) => p.type === "video" && !p.isDefault),
			name: "extra"
		};
		const added = await account("POST", `/presets/${name}/profiles`, { expectedVersion: 1, profile: extra });
		const stale = await account("PATCH", `/presets/${name}/profiles/extra`, { expectedVersion: 1, priority: 5 });
		const patched = await account("PATCH", `/presets/${name}/profiles/extra`, { expectedVersion: 2, priority: 5 });
		const removed = await account("DELETE", `/presets/${name}/profiles/extra?expectedVersion=3`);
		const deleted = await account("DELETE", `/presets/${name}?expectedVersion=4`);

		expect(created.status).toBe(201);
		expect(added.body?.version).toBe(2);
		expect(stale.status).toBe(409);
		expect(patched.body?.version).toBe(3);
		expect(removed.body?.version).toBe(4);
		expect(deleted.status).toBe(204);
	});

	it("reports usage and callback deliveries for finished requests", async () => {
		const today = new Date().toISOString().slice(0, 10);
		const usage = await account("GET", `/usage?from=${today}&to=${today}`);
		const callbacks = await account("GET", `/requests/${asyncRequestId}/callbacks`);

		expect(usage.status).toBe(200);
		expect(usage.body?.requests).toBeGreaterThanOrEqual(2);
		expect(usage.body?.units).toHaveProperty("outputGb");
		expect(callbacks.status).toBe(200);
		expect(Array.isArray(callbacks.body?.deliveries)).toBe(true);
	});

	it("cancels a fresh request with 200", async () => {
		const key = await uploadSource(FIXTURE);
		const created = await account("POST", "/encode", {
			source: { bucket: local.sourceBucket, key },
			preset: "generic",
			postProcess: POST_PROCESS_OFF,
			analyze: "async"
		});

		const cancelled = await account("DELETE", `/requests/${created.body?.id}`);

		expect(cancelled.status).toBe(200);
		expect(cancelled.body?.status).toBe("CANCELLED");
	});

	it(
		"purges an asset with 202, after which it returns 404 and its outputs are gone",
		async () => {
			const assetId = asyncAssetId;

			const purge = await account("DELETE", `/assets/${assetId}`);
			await drainUntil(
				async () => (await requests().findOne({ accountId, assetId, mode: "purge" }))?.status === "COMPLETE"
			);
			const gone = await account("GET", `/assets/${assetId}`);

			expect(purge.status).toBe(202);
			expect(gone.status).toBe(404);
			expect(await objectStore().listKeys(`${slug}/media/${assetId}/`)).toEqual([]);
		},
		TEST_TIMEOUT_MS
	);
});
