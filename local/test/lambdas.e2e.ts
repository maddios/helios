import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetQueueUrlCommand, PurgeQueueCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { Preset, VideoSourceMetadata } from "@helios/contracts";
import {
	accounts,
	dlqName,
	fullQueueName,
	apiKeys,
	callbackDeliveries,
	closeDb,
	createAccount,
	createApiKey,
	createRequest,
	ensureIndexes,
	genericPreset,
	initDb,
	insertAsset,
	jobReports,
	mediaAssets,
	objectStore,
	pipelineItems,
	queueTopology,
	requests,
	resolvePostProcess,
	usageDaily,
	type Account,
	type MediaAsset
} from "@helios/core";
import { createApp } from "../../api/src/app";
import { runWorker } from "../../worker/src/pollLoop";
import { bootstrap } from "../bootstrap";
import { FIXTURE_DIR, generateFixtures } from "../fixtures";
import { runLambdaSources, type LambdaSourceKey } from "../lambdaRunner";
import { loadLocalConfig } from "../loadConfig";
import { startWebhookSink, type WebhookSink } from "../webhookSink";

process.env.LOG_LEVEL = "warn";

const local = loadLocalConfig();
const FIXTURE = "h300.mp4";
const POST_PROCESS_OFF = { transcribe: false, sceneDetection: false } as const;
const POLL_MS = 500;
const LAMBDA_P1_TIMEOUT_SEC = 5;
const STUCK_AGE_MS = 120000;
const suffix = randomUUID().slice(0, 8);
const s3 = new S3Client({ region: local.awsRegion, endpoint: local.awsEndpoint, forcePathStyle: true });
const createdAccounts: Account[] = [];
const uploadedSources: string[] = [];
const profiles = genericPreset.profiles.map((profile) =>
	profile.name === "mp4_360" ? { ...profile, isDefault: false } : profile
);
const NON_DEFAULT_PRESET: Preset = { ...genericPreset, profiles };

let server: Server;
let sink: WebhookSink;
let base = "";
let hook: Account;

function sourceMetadata(): VideoSourceMetadata {
	return {
		type: "video",
		sizeBytes: fs.statSync(path.join(FIXTURE_DIR, FIXTURE)).size,
		width: 534,
		height: 300,
		durationSec: 9,
		fps: 30,
		videoCodec: "h264",
		hasAudio: true
	};
}

async function uploadSource(accountId: string): Promise<string> {
	const key = `e2e/${accountId}/${FIXTURE}`;
	await s3.send(
		new PutObjectCommand({
			Bucket: local.sourceBucket,
			Key: key,
			Body: fs.readFileSync(path.join(FIXTURE_DIR, FIXTURE))
		})
	);
	uploadedSources.push(key);
	return key;
}

async function newAccount(label: string): Promise<Account> {
	const account = await createAccount({
		slug: `e2e-${label}-${randomUUID().slice(0, 8)}`,
		name: `E2E ${label}`,
		sourceBuckets: [local.sourceBucket],
		features: { peopleAttributes: false },
		destination: { type: "webhook", url: sink.url }
	});
	createdAccounts.push(account);
	hook = account;
	return account;
}

async function insertAssetFor(
	account: Account,
	key: string,
	withMetadata: boolean,
	preset: Preset = genericPreset
): Promise<MediaAsset> {
	const asset: MediaAsset = {
		_id: randomUUID(),
		accountId: account._id,
		source: { type: "s3", bucket: local.sourceBucket, key },
		...(withMetadata && { sourceMetadata: sourceMetadata() }),
		presetName: genericPreset.name,
		presetVersion: genericPreset.version,
		presetSnapshot: preset,
		version: 1,
		outputs: {},
		createdAt: new Date(),
		updatedAt: new Date()
	};
	await insertAsset(asset);
	return asset;
}

async function startEncode(asset: MediaAsset, preset: Preset): Promise<string> {
	const { request } = await createRequest({
		asset,
		mode: "encode",
		preset,
		postProcess: POST_PROCESS_OFF,
		analyze: "sync"
	});
	return request._id;
}

async function insertStuckRequest(asset: MediaAsset, status: "ANALYZING" | "IN_PROGRESS"): Promise<string> {
	const _id = randomUUID();
	await requests().insertOne({
		_id,
		accountId: asset.accountId,
		assetId: asset._id,
		clientRequestId: _id,
		mode: "encode",
		analyze: "async",
		presetSnapshot: genericPreset,
		postProcess: resolvePostProcess(POST_PROCESS_OFF, genericPreset.postProcess),
		assetVersion: asset.version,
		pendingItems: [],
		status,
		createdAt: new Date(Date.now() - STUCK_AGE_MS)
	});
	return _id;
}

async function encodeViaApi(apiKey: string, body: Record<string, unknown>): Promise<{ status: number; id: string }> {
	const res = await fetch(`${base}/encode`, {
		method: "POST",
		headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
		body: JSON.stringify(body)
	});
	return { status: res.status, id: ((await res.json()) as { id: string }).id };
}

async function settled(requestId: string): Promise<boolean> {
	const request = await requests().findOne({ _id: requestId });
	const terminal = request?.status === "COMPLETE" || request?.status === "ERROR";
	const expected = (await pipelineItems().countDocuments({ requestId })) + 1;
	const settledDeliveries = await callbackDeliveries().countDocuments({ requestId, status: { $ne: "PENDING" } });
	return terminal && settledDeliveries === expected;
}

async function waitUntil(probe: () => Promise<boolean>, deadlineMs: number): Promise<void> {
	const deadline = Date.now() + deadlineMs;
	while (!(await probe())) {
		if (Date.now() > deadline) {
			throw new Error(`Condition not met within ${deadlineMs} ms`);
		}
		await sleep(POLL_MS);
	}
}

async function runUntilSettled(
	requestId: string,
	deadlineMs: number,
	timeoutsSec?: Partial<Record<LambdaSourceKey, number>>
): Promise<void> {
	const controller = new AbortController();
	const running = Promise.all([
		runLambdaSources({ signal: controller.signal, timeoutsSec }),
		runWorker({ signal: controller.signal })
	]);
	try {
		await waitUntil(() => settled(requestId), deadlineMs);
	} finally {
		controller.abort();
		await running;
	}
}

async function purgeE2eQueues(): Promise<void> {
	const sqs = new SQSClient({ region: local.awsRegion, endpoint: local.awsEndpoint });
	for (const name of queueTopology.flatMap((spec) =>
		spec.redrive.target === "dlq" ? [spec.name, dlqName(spec.name)] : [spec.name]
	)) {
		const { QueueUrl } = await sqs.send(
			new GetQueueUrlCommand({ QueueName: fullQueueName(local.e2eQueuePrefix, name) })
		);
		await sqs.send(new PurgeQueueCommand({ QueueUrl }));
	}
	sqs.destroy();
}

beforeAll(async () => {
	generateFixtures();
	await bootstrap(local.e2eQueuePrefix, [local.mediaBucket, local.sourceBucket], local.lambdas.e2eVisibilityTimeoutSec);
	await purgeE2eQueues();
	await initDb(local.mongoUri);
	await ensureIndexes();
	sink = await startWebhookSink({ secret: () => hook.webhookSecret });
	server = createApp().listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", () => resolve()));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
	sink.events.length = 0;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await sink.close();
	const ids = createdAccounts.map((account) => account._id);
	await Promise.all([
		mediaAssets().deleteMany({ accountId: { $in: ids } }),
		requests().deleteMany({ accountId: { $in: ids } }),
		pipelineItems().deleteMany({ accountId: { $in: ids } }),
		jobReports().deleteMany({ accountId: { $in: ids } }),
		usageDaily().deleteMany({ accountId: { $in: ids } }),
		callbackDeliveries().deleteMany({ accountId: { $in: ids } }),
		apiKeys().deleteMany({ accountId: { $in: ids } }),
		accounts().deleteMany({ _id: { $in: ids } })
	]);
	for (const account of createdAccounts) {
		await objectStore().deleteKeys(await objectStore().listKeys(`${account.slug}/`));
	}
	if (uploadedSources.length > 0) {
		await s3.send(
			new DeleteObjectsCommand({
				Bucket: local.sourceBucket,
				Delete: { Objects: uploadedSources.map((Key) => ({ Key })) }
			})
		);
	}
	s3.destroy();
	await closeDb();
});

describe("lambda sources and in-process fargate worker against LocalStack and Mongo", () => {
	it("completes an async API encode and delivers signed callbacks in sequence order", async () => {
		const account = await newAccount("flow");
		const apiKey = (await createApiKey({ scope: "account", accountId: account._id, name: `e2e-${suffix}` })).key;
		const key = await uploadSource(account._id);

		const created = await encodeViaApi(apiKey, {
			source: { bucket: local.sourceBucket, key },
			preset: "generic",
			postProcess: POST_PROCESS_OFF,
			analyze: "async"
		});
		await runUntilSettled(created.id, 150000);

		const names = sink.events.map((event) => event.body.event);
		const sequences = sink.events.map((event) => event.body.sequence as number);
		expect(created.status).toBe(202);
		expect(await requests().findOne({ _id: created.id })).toMatchObject({ status: "COMPLETE" });
		expect(sink.events.every((event) => event.verified && event.status === 200)).toBe(true);
		expect(names).toContain("item.completed");
		expect(names.at(-1)).toBe("request.completed");
		expect(new Set(sequences).size).toBe(sequences.length);
		expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
	}, 120000);

	it("redrives a timed-out lambda-p1 item to fargate-p1 and completes it", async () => {
		const account = await newAccount("redrive");
		const asset = await insertAssetFor(account, await uploadSource(account._id), true);
		const requestId = await startEncode(asset, genericPreset);

		await runUntilSettled(requestId, 170000, { "lambda-p1": LAMBDA_P1_TIMEOUT_SEC });

		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
		const item = await pipelineItems().findOne({ requestId, queue: "lambda-p1" });
		expect(item).toMatchObject({ status: "COMPLETE" });
		expect(item?.attempts).toBeGreaterThanOrEqual(2);
	}, 180000);

	it("moves an encode whose source is missing to fargate-p2-dlq and settles the request as ERROR", async () => {
		const account = await newAccount("missing");
		const missingKey = `e2e/missing-${randomUUID()}/${FIXTURE}`;
		const asset = await insertAssetFor(account, missingKey, true, NON_DEFAULT_PRESET);
		const requestId = await startEncode(asset, NON_DEFAULT_PRESET);

		await runUntilSettled(requestId, 170000);

		const items = await pipelineItems().find({ requestId, kind: "encode" }).toArray();
		const failed = sink.events.filter((event) => event.body.event === "request.failed");
		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "ERROR" });
		expect(items.length).toBeGreaterThan(0);
		expect(items.every((item) => item.status === "ERROR" && item.queue === "fargate-p2")).toBe(true);
		expect(failed).toHaveLength(1);
		expect(failed[0]?.body.data).toMatchObject({
			request: {
				status: "ERROR",
				items: expect.arrayContaining([expect.objectContaining({ error: expect.any(String) })])
			}
		});
	}, 180000);

	it("retries a callback rejected with 500 and delivers it on the second attempt", async () => {
		const account = await newAccount("retry");
		const asset = await insertAssetFor(account, await uploadSource(account._id), true);
		sink.respondWith(500);
		const requestId = await startEncode(asset, genericPreset);

		await runUntilSettled(requestId, 200000);

		const retried = await callbackDeliveries().findOne({ requestId, "attempts.1": { $exists: true } });
		expect(retried).toMatchObject({
			status: "DELIVERED",
			attempts: [{ status: "FAILED", httpStatus: 500 }, { status: "DELIVERED" }]
		});
		expect(sink.events.filter((event) => event.status === 500)).toHaveLength(1);
		expect(sink.events.some((event) => event.verified && event.status === 200)).toBe(true);
	}, 240000);

	it("resumes a stuck ANALYZING request that never received its analyze message", async () => {
		const account = await newAccount("resume-analyze");
		const asset = await insertAssetFor(account, await uploadSource(account._id), false);
		const requestId = await insertStuckRequest(asset, "ANALYZING");

		await runUntilSettled(requestId, 150000);

		expect(await requests().findOne({ _id: requestId })).toMatchObject({
			status: "COMPLETE",
			resumedAt: expect.any(Date)
		});
	}, 170000);

	it("launches a stuck IN_PROGRESS request that was never enqueued", async () => {
		const account = await newAccount("resume-launch");
		const asset = await insertAssetFor(account, await uploadSource(account._id), true);
		const requestId = await insertStuckRequest(asset, "IN_PROGRESS");

		await runUntilSettled(requestId, 150000);

		expect(await requests().findOne({ _id: requestId })).toMatchObject({
			status: "COMPLETE",
			enqueuedAt: expect.any(Date)
		});
	}, 170000);
});
