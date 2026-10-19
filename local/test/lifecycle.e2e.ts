import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { VideoSourceMetadata } from "@helios/contracts";
import {
	accounts,
	analyzeRequest,
	cancelRequest,
	closeDb,
	createRequest,
	ensureIndexes,
	genericPreset,
	initDb,
	insertAsset,
	jobReports,
	mediaAssets,
	objectStore,
	ingestKey,
	pipelineItems,
	queueFor,
	requestPurge,
	requests,
	sceneAnalyses,
	transcripts,
	usageDaily,
	type CallbackMessage,
	type MediaAsset,
	type MediaAssetSource
} from "@helios/core";
import { bootstrap } from "../bootstrap";
import { loadLocalConfig } from "../loadConfig";
import { FIXTURE_DIR } from "../fixtures";
import { drainUntilTerminal } from "./drain";

process.env.LOG_LEVEL = "warn";

const local = loadLocalConfig();
const CALLBACK_DEADLINE_MS = 30000;
const POST_PROCESS_OFF = { transcribe: false, sceneDetection: false } as const;
const H300_NAME = "h300.mp4";
const H300_METADATA: VideoSourceMetadata = {
	type: "video",
	sizeBytes: fixtureBytes(H300_NAME).length,
	width: 534,
	height: 300,
	durationSec: 9,
	fps: 30,
	videoCodec: "h264",
	hasAudio: true
};

const accountId = `e2e-${randomUUID()}`;
const slug = `e2e-${accountId.slice(4, 12)}`;
const s3 = new S3Client({ region: local.awsRegion, endpoint: local.awsEndpoint, forcePathStyle: true });
const uploadedSources: string[] = [];
let closeFixtureServer: (() => Promise<void>) | undefined;
let encoded: MediaAsset;

function fixtureBytes(name: string): Buffer {
	const localPath = path.join(FIXTURE_DIR, name);
	if (!fs.existsSync(localPath)) {
		throw new Error(`Missing fixture ${localPath}; run npm run local:fixtures`);
	}
	return fs.readFileSync(localPath);
}

async function uploadSource(name: string, body: Buffer): Promise<string> {
	const key = `e2e/${accountId}/${name}`;
	await s3.send(new PutObjectCommand({ Bucket: local.sourceBucket, Key: key, Body: body }));
	uploadedSources.push(key);
	return key;
}

async function newAsset(source: MediaAssetSource, sourceMetadata?: MediaAsset["sourceMetadata"]): Promise<MediaAsset> {
	const asset: MediaAsset = {
		_id: randomUUID(),
		accountId,
		source,
		...(sourceMetadata !== undefined && { sourceMetadata }),
		presetName: genericPreset.name,
		presetVersion: genericPreset.version,
		presetSnapshot: genericPreset,
		version: 1,
		outputs: {},
		createdAt: new Date(),
		updatedAt: new Date()
	};
	await insertAsset(asset);
	return asset;
}

async function assetDoc(assetId: string): Promise<MediaAsset> {
	const asset = await mediaAssets().findOne({ _id: assetId, accountId });
	if (asset === null) {
		throw new Error(`Asset ${assetId} missing`);
	}
	return asset;
}

async function outputKeys(assetId: string): Promise<string[]> {
	const prefix = `${slug}/media/${assetId}/`;
	return (await objectStore().listKeys(prefix)).map((key) => key.slice(prefix.length));
}

async function itemCount(requestId: string): Promise<number> {
	return pipelineItems().countDocuments({ requestId });
}

function callbackQueue() {
	return queueFor<CallbackMessage>("callbacks.fifo");
}

async function callbacksFor(requestId: string): Promise<CallbackMessage[]> {
	const expected = (await itemCount(requestId)) + 1;
	const seen: CallbackMessage[] = [];
	const deadline = Date.now() + CALLBACK_DEADLINE_MS;
	while (seen.length < expected && Date.now() < deadline) {
		seen.push(...(await receiveFor(requestId)));
	}
	return [...seen, ...(await receiveFor(requestId))];
}

async function receiveFor(requestId: string): Promise<CallbackMessage[]> {
	const queue = callbackQueue();
	const matches: CallbackMessage[] = [];
	for (const message of await queue.poll(10, 1)) {
		if (message.body.requestId === requestId) {
			matches.push(message.body);
		}
		await queue.ack(message);
	}
	return matches;
}

function finalCallbacks(messages: CallbackMessage[]): CallbackMessage[] {
	return messages.filter((message) => message.type === "request");
}

async function startFixtureServer(name: string): Promise<{ url: string; close: () => Promise<void> }> {
	const body = fixtureBytes(name);
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { "content-type": "video/mp4", "content-length": body.length });
		res.end(body);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/${name}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((err) => (err === undefined ? resolve() : reject(err)));
			})
	};
}

describe("request lifecycle against LocalStack and Mongo", () => {
	beforeAll(async () => {
		await bootstrap(local.e2eQueuePrefix, [local.mediaBucket, local.sourceBucket], local.worker.visibilityExtensionSec);
		await initDb(local.mongoUri);
		await ensureIndexes();
		await accounts().insertOne({
			_id: accountId,
			slug,
			name: "E2E lifecycle",
			sourceBuckets: [local.sourceBucket],
			webhookSecret: "e2e",
			features: { peopleAttributes: false },
			createdAt: new Date()
		});
	});

	afterAll(async () => {
		await closeFixtureServer?.();
		await Promise.all([
			mediaAssets().deleteMany({ accountId }),
			requests().deleteMany({ accountId }),
			pipelineItems().deleteMany({ accountId }),
			jobReports().deleteMany({ accountId }),
			usageDaily().deleteMany({ accountId }),
			transcripts().deleteMany({ accountId }),
			sceneAnalyses().deleteMany({ accountId }),
			accounts().deleteMany({ _id: accountId })
		]);
		const mediaKeys = await objectStore().listKeys(`${slug}/`);
		await objectStore().deleteKeys(mediaKeys);
		if (uploadedSources.length > 0) {
			await s3.send(
				new DeleteObjectsCommand({
					Bucket: local.sourceBucket,
					Delete: { Objects: uploadedSources.map((Key) => ({ Key })) }
				})
			);
		}
		await closeDb();
	});

	it("S3 source: analyze, encode, then COMPLETE with outputs, report and final callback", async () => {
		const key = await uploadSource(H300_NAME, fixtureBytes(H300_NAME));
		const asset = await newAsset({ type: "s3", bucket: local.sourceBucket, key });
		const { request } = await createRequest({
			asset,
			mode: "encode",
			preset: genericPreset,
			postProcess: POST_PROCESS_OFF,
			analyze: "async"
		});
		expect(request.status).toBe("ANALYZING");

		await analyzeRequest(request._id);
		expect(await requests().findOne({ _id: request._id })).toMatchObject({ status: "IN_PROGRESS" });
		expect((await assetDoc(asset._id)).sourceMetadata).toMatchObject({
			type: "video",
			width: 534,
			height: 300,
			hasAudio: true
		});

		await drainUntilTerminal([request._id]);
		expect(await requests().findOne({ _id: request._id })).toMatchObject({ status: "COMPLETE" });
		expect(await jobReports().findOne({ requestId: request._id })).toMatchObject({ status: "COMPLETE" });
		expect(await outputKeys(asset._id)).toEqual(expect.arrayContaining([`${asset._id}.mp4`, `${asset._id}.mp3`]));
		expect(Object.keys((await assetDoc(asset._id)).outputs).sort()).toEqual(["audio", "mp4_360", "stills"]);

		expect(finalCallbacks(await callbacksFor(request._id))).toHaveLength(1);
		encoded = await assetDoc(asset._id);
	});

	it("URL source: ingests into the account source key, persists it and encodes to COMPLETE", async () => {
		const fixture = await startFixtureServer(H300_NAME);
		closeFixtureServer = fixture.close;
		const asset = await newAsset({ type: "url", url: fixture.url });
		const { request } = await createRequest({
			asset,
			mode: "encode",
			preset: genericPreset,
			postProcess: POST_PROCESS_OFF,
			analyze: "async"
		});

		await analyzeRequest(request._id);
		const ingestedKey = ingestKey(slug, asset._id);
		expect(await assetDoc(asset._id)).toMatchObject({
			source: { type: "url", url: fixture.url, ingestedKey },
			sourceMetadata: { type: "video", width: 534, height: 300 }
		});
		expect(await objectStore().listKeys(ingestedKey)).toEqual([ingestedKey]);

		await drainUntilTerminal([request._id]);
		expect(await requests().findOne({ _id: request._id })).toMatchObject({ status: "COMPLETE" });
		expect(Object.keys((await assetDoc(asset._id)).outputs).sort()).toEqual(["audio", "mp4_360", "stills"]);
		expect(finalCallbacks(await callbacksFor(request._id))).toHaveLength(1);
	});

	it("unprocessable source: ERROR with error set, final callback and no items", async () => {
		const key = await uploadSource("notes.txt", Buffer.from("this is not media\n"));
		const asset = await newAsset({ type: "s3", bucket: local.sourceBucket, key });
		const { request } = await createRequest({
			asset,
			mode: "encode",
			preset: genericPreset,
			postProcess: POST_PROCESS_OFF,
			analyze: "async"
		});

		await analyzeRequest(request._id);
		expect(await requests().findOne({ _id: request._id })).toMatchObject({
			status: "ERROR",
			error: { code: "unprocessable_source", message: expect.any(String) }
		});
		expect(await itemCount(request._id)).toBe(0);
		expect((await assetDoc(asset._id)).sourceMetadata).toBeUndefined();
		expect(finalCallbacks(await callbacksFor(request._id))).toHaveLength(1);
	});

	it("cancel before draining: CANCELLED items, one final callback, second cancel is a no-op", async () => {
		const key = await uploadSource(H300_NAME, fixtureBytes(H300_NAME));
		const asset = await newAsset({ type: "s3", bucket: local.sourceBucket, key }, H300_METADATA);
		const { request } = await createRequest({
			asset,
			mode: "encode",
			preset: genericPreset,
			postProcess: POST_PROCESS_OFF,
			analyze: "async"
		});
		expect(request).toMatchObject({ status: "IN_PROGRESS" });

		const cancelled = await cancelRequest(accountId, request._id);
		expect(cancelled).toMatchObject({ status: "CANCELLED" });
		const items = await pipelineItems().find({ requestId: request._id }).toArray();
		expect(items.length).toBeGreaterThan(0);
		expect(items.every((item) => item.status === "CANCELLED")).toBe(true);

		const again = await cancelRequest(accountId, request._id);
		expect(again).toMatchObject({ status: "CANCELLED", completedAt: cancelled.completedAt });
		expect(await pipelineItems().countDocuments({ requestId: request._id })).toBe(items.length);
		expect(finalCallbacks(await callbacksFor(request._id))).toHaveLength(1);
	});

	it("purge: tombstones the asset, deletes its keys and rows, and sends asset.deleted", async () => {
		await transcripts().insertOne({
			_id: `${encoded._id}:en`,
			accountId,
			assetId: encoded._id,
			createdAt: new Date(),
			language: "en",
			isTranslation: false,
			segments: [{ start: 0, end: 1, text: "hello" }],
			text: "hello",
			durationSec: 9,
			model: "e2e"
		});
		await sceneAnalyses().insertOne({
			_id: `${encoded._id}:scenes`,
			accountId,
			assetId: encoded._id,
			createdAt: new Date(),
			promptVersion: "e2e",
			model: "e2e",
			transcriptLanguage: null,
			summary: { title: "t", description: "d", setting: "s", products: [], people: [], moods: [], tags: [] },
			scenes: []
		});

		const purge = await requestPurge(accountId, encoded._id);
		expect(purge).toMatchObject({ mode: "purge", status: "IN_PROGRESS" });
		expect((await assetDoc(encoded._id)).deletedAt).toBeInstanceOf(Date);
		expect(await pipelineItems().find({ requestId: purge._id }).toArray()).toEqual([
			expect.objectContaining({ kind: "purge", queue: "fargate-p2" })
		]);

		await drainUntilTerminal([purge._id]);
		expect(await requests().findOne({ _id: purge._id })).toMatchObject({ status: "COMPLETE" });
		expect(await outputKeys(encoded._id)).toEqual([]);
		expect(await objectStore().listKeys(`${slug}/sources/${encoded._id}/`)).toEqual([]);
		expect(await transcripts().countDocuments({ assetId: encoded._id })).toBe(0);
		expect(await sceneAnalyses().countDocuments({ assetId: encoded._id })).toBe(0);
		expect(await pipelineItems().countDocuments({ assetId: encoded._id, requestId: { $ne: purge._id } })).toBe(0);

		const finals = finalCallbacks(await callbacksFor(purge._id));
		expect(finals).toEqual([{ type: "request", requestId: purge._id, sequence: expect.any(Number) }]);
	});
});
