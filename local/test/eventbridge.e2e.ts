import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DeleteMessageCommand, GetQueueUrlCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { VideoSourceMetadata } from "@helios/contracts";
import {
	accounts,
	apiKeys,
	callbackDeliveries,
	closeDb,
	createAccount,
	createApiKey,
	createRequest,
	deliverCallback,
	ensureIndexes,
	genericPreset,
	initDb,
	insertAsset,
	jobReports,
	mediaAssets,
	objectStore,
	pipelineItems,
	queueFor,
	requests,
	usageDaily,
	type Account,
	type CallbackMessage,
	type MediaAsset
} from "@helios/core";
import { createApp } from "../../api/src/app";
import { bootstrap, captureQueueName, localEventBusArn } from "../bootstrap";
import { FIXTURE_DIR, generateFixtures } from "../fixtures";
import { loadLocalConfig } from "../loadConfig";
import { startWebhookSink, type WebhookSink } from "../webhookSink";
import { drainUntilTerminal } from "./drain";

process.env.LOG_LEVEL = "warn";

const local = loadLocalConfig();
const FIXTURE = "h300.mp4";
const CALLBACK_DEADLINE_MS = 30000;
const CAPTURE_DEADLINE_MS = 30000;
const POST_PROCESS_OFF = { transcribe: false, sceneDetection: false } as const;
const suffix = randomUUID().slice(0, 8);
const busArn = localEventBusArn(local);
const s3 = new S3Client({ region: local.awsRegion, endpoint: local.awsEndpoint, forcePathStyle: true });
const sqs = new SQSClient({ region: local.awsRegion, endpoint: local.awsEndpoint });
const uploadedSources: string[] = [];

interface CapturedEvent {
	source: string;
	"detail-type": string;
	detail: { sequence: number; data: { requestId?: string; request?: { id: string } } };
}

interface TestResult {
	ok: boolean;
	error?: { code: string; message: string; hint: string };
}

let server: Server | undefined;
let sink: WebhookSink;
let base = "";
let ebAccount: Account;
let hookAccount: Account;
let eventBridgeKey = "";

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

async function encodeFixture(accountId: string): Promise<string> {
	const asset: MediaAsset = {
		_id: randomUUID(),
		accountId,
		source: { type: "s3", bucket: local.sourceBucket, key: await uploadSource(accountId) },
		sourceMetadata: sourceMetadata(),
		presetName: genericPreset.name,
		presetVersion: genericPreset.version,
		presetSnapshot: genericPreset,
		version: 1,
		outputs: {},
		createdAt: new Date(),
		updatedAt: new Date()
	};
	await insertAsset(asset);
	const { request } = await createRequest({
		asset,
		mode: "encode",
		preset: genericPreset,
		postProcess: POST_PROCESS_OFF,
		analyze: "sync"
	});
	await drainUntilTerminal([request._id]);
	return request._id;
}

async function deliverCallbacks(requestId: string): Promise<number> {
	const expected = (await pipelineItems().countDocuments({ requestId })) + 1;
	const queue = queueFor<CallbackMessage>("callbacks.fifo");
	const deadline = Date.now() + CALLBACK_DEADLINE_MS;
	let delivered = 0;
	while (delivered < expected && Date.now() < deadline) {
		for (const message of await queue.poll(10, 1)) {
			if ("requestId" in message.body && message.body.requestId === requestId) {
				await deliverCallback(message.body, message.receiveCount);
				delivered += 1;
			}
			await queue.ack(message);
		}
	}
	if (delivered !== expected) {
		throw new Error(`Delivered ${delivered} of ${expected} callbacks for request ${requestId}`);
	}
	return expected;
}

function belongsTo(event: CapturedEvent, requestId: string): boolean {
	return (event.detail.data.requestId ?? event.detail.data.request?.id) === requestId;
}

async function captureFor(requestId: string, expected: number): Promise<CapturedEvent[]> {
	const QueueUrl = (await sqs.send(new GetQueueUrlCommand({ QueueName: captureQueueName(local) }))).QueueUrl;
	const matches: CapturedEvent[] = [];
	const deadline = Date.now() + CAPTURE_DEADLINE_MS;
	while (matches.length < expected && Date.now() < deadline) {
		const { Messages = [] } = await sqs.send(
			new ReceiveMessageCommand({ QueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 })
		);
		for (const message of Messages) {
			const event = JSON.parse(message.Body ?? "") as CapturedEvent;
			if (belongsTo(event, requestId)) {
				matches.push(event);
			}
			await sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: message.ReceiptHandle }));
		}
	}
	return matches;
}

async function testDestination(destination: unknown): Promise<{ status: number; body: TestResult }> {
	const res = await fetch(`${base}/destinations/test`, {
		method: "POST",
		headers: { authorization: `Bearer ${eventBridgeKey}`, "content-type": "application/json" },
		body: JSON.stringify({ destination })
	});
	return { status: res.status, body: (await res.json()) as TestResult };
}

beforeAll(async () => {
	generateFixtures();
	await bootstrap(local.e2eQueuePrefix, [local.mediaBucket, local.sourceBucket], local.worker.visibilityExtensionSec);
	await initDb(local.mongoUri);
	await ensureIndexes();
	sink = await startWebhookSink({ secret: () => hookAccount.webhookSecret });
	ebAccount = await createAccount({
		slug: `e2e-eb-${suffix}`,
		name: "E2E EventBridge",
		sourceBuckets: [local.sourceBucket],
		features: { peopleAttributes: false },
		destination: { type: "eventbridge", eventBusArn: busArn }
	});
	hookAccount = await createAccount({
		slug: `e2e-hook-${suffix}`,
		name: "E2E webhook",
		sourceBuckets: [local.sourceBucket],
		features: { peopleAttributes: false },
		destination: { type: "webhook", url: sink.url }
	});
	eventBridgeKey = (await createApiKey({ scope: "account", accountId: ebAccount._id, name: `e2e-${suffix}` })).key;
	server = createApp().listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
	await sink.close();
	const accountIds = [ebAccount._id, hookAccount._id];
	await Promise.all([
		mediaAssets().deleteMany({ accountId: { $in: accountIds } }),
		requests().deleteMany({ accountId: { $in: accountIds } }),
		pipelineItems().deleteMany({ accountId: { $in: accountIds } }),
		jobReports().deleteMany({ accountId: { $in: accountIds } }),
		usageDaily().deleteMany({ accountId: { $in: accountIds } }),
		callbackDeliveries().deleteMany({ accountId: { $in: accountIds } }),
		apiKeys().deleteMany({ accountId: { $in: accountIds } }),
		accounts().deleteMany({ _id: { $in: accountIds } })
	]);
	for (const account of [ebAccount, hookAccount]) {
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
	sqs.destroy();
	s3.destroy();
	await closeDb();
});

describe("EventBridge and webhook destinations against LocalStack and Mongo", () => {
	it("delivers item and request events to the bus, captured by SQS with unique increasing sequences", async () => {
		const requestId = await encodeFixture(ebAccount._id);
		const expected = await deliverCallbacks(requestId);
		const events = await captureFor(requestId, expected);
		const sequences = events.map((event) => event.detail.sequence);
		const bySequence = [...events].sort((a, b) => a.detail.sequence - b.detail.sequence);

		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
		expect(events).toHaveLength(expected);
		expect(events.map((event) => event["detail-type"])).toEqual(
			expect.arrayContaining(["item.completed", "request.completed"])
		);
		expect(events.every((event) => event.source === `helios.${ebAccount._id}`)).toBe(true);
		expect(new Set(sequences).size).toBe(sequences.length);
		expect(bySequence.at(-1)?.["detail-type"]).toBe("request.completed");
	});

	it("returns ok for a test event sent to a real bus", async () => {
		const res = await testDestination({ type: "eventbridge", eventBusArn: busArn });

		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ ok: true });
	});

	it("keeps webhook delivery working and signs each callback with a sequence", async () => {
		sink.events.length = 0;
		const requestId = await encodeFixture(hookAccount._id);
		const expected = await deliverCallbacks(requestId);
		const sinkBodies = sink.events.map((event) => event.body);
		const sequences = sinkBodies.map((body) => body.sequence);

		expect(sinkBodies).toHaveLength(expected);
		expect(sinkBodies.every((body) => typeof body.sequence === "number")).toBe(true);
		expect(new Set(sequences).size).toBe(sequences.length);
		expect(sinkBodies.some((body) => body.event === "request.completed")).toBe(true);
	});
});
