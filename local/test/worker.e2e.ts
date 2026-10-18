import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ImageSourceMetadata, VideoSourceMetadata } from "@helios/contracts";
import {
	accounts,
	closeDb,
	createRequest,
	ensureIndexes,
	genericPreset,
	initDb,
	jobReports,
	mediaAssets,
	objectStore,
	pipelineItems,
	queueFor,
	requests,
	usageDaily,
	type CallbackMessage,
	type MediaAsset
} from "@helios/core";
import { bootstrap } from "../bootstrap";
import { loadLocalConfig } from "../loadConfig";
import { FIXTURE_DIR, IMAGE_FIXTURE, VIDEO_FIXTURES } from "../fixtures";
import { drainUntilTerminal } from "./drain";

process.env.LOG_LEVEL = "warn";

const local = loadLocalConfig();
const FRAME_INTERVAL_SEC = 3;
const H1080_DURATION_SEC = 12;
const POST_PROCESS_OFF = { transcribe: false, sceneDetection: false } as const;

const accountId = `e2e-${randomUUID()}`;
const slug = `e2e-${accountId.slice(4, 12)}`;
const s3 = new S3Client({ region: local.awsRegion, endpoint: local.awsEndpoint, forcePathStyle: true });
const uploadedSources: string[] = [];

function videoFixture(name: string) {
	const fixture = VIDEO_FIXTURES.find((candidate) => candidate.name === name);
	if (fixture === undefined) {
		throw new Error(`unknown fixture ${name}`);
	}
	return fixture;
}

async function uploadSource(name: string): Promise<string> {
	const key = `e2e/${accountId}/${name}`;
	const localPath = path.join(FIXTURE_DIR, name);
	if (!fs.existsSync(localPath)) {
		throw new Error(`Missing fixture ${localPath}; run npm run local:fixtures`);
	}
	await s3.send(new PutObjectCommand({ Bucket: local.sourceBucket, Key: key, Body: fs.readFileSync(localPath) }));
	uploadedSources.push(key);
	return key;
}

function videoMetadata(name: string): VideoSourceMetadata {
	const fixture = videoFixture(name);
	return {
		type: "video",
		sizeBytes: fs.statSync(path.join(FIXTURE_DIR, name)).size,
		width: fixture.width,
		height: fixture.height,
		durationSec: fixture.durationSec,
		fps: 30,
		videoCodec: "h264",
		hasAudio: fixture.hasAudio
	};
}

function imageMetadata(): ImageSourceMetadata {
	return {
		type: "image",
		sizeBytes: fs.statSync(path.join(FIXTURE_DIR, IMAGE_FIXTURE.name)).size,
		width: IMAGE_FIXTURE.width,
		height: IMAGE_FIXTURE.height,
		hasAudio: false
	};
}

async function createAsset(name: string, sourceMetadata: MediaAsset["sourceMetadata"]): Promise<MediaAsset> {
	const key = await uploadSource(name);
	const asset: MediaAsset = {
		_id: randomUUID(),
		accountId,
		source: { type: "s3", bucket: local.sourceBucket, key },
		sourceMetadata,
		presetName: genericPreset.name,
		presetVersion: genericPreset.version,
		presetSnapshot: genericPreset,
		version: 1,
		outputs: {},
		createdAt: new Date(),
		updatedAt: new Date()
	};
	await mediaAssets().insertOne(asset);
	return asset;
}

async function outputKeys(assetId: string): Promise<string[]> {
	return (await objectStore().listKeys(`${slug}/media/${assetId}/`)).map((key) =>
		key.slice(`${slug}/media/${assetId}/`.length)
	);
}

async function assetDoc(assetId: string): Promise<MediaAsset> {
	const asset = await mediaAssets().findOne({ _id: assetId, accountId });
	if (asset === null) {
		throw new Error(`Asset ${assetId} missing`);
	}
	return asset;
}

async function callbackRequestIds(expected: Map<string, number>): Promise<Map<string, number>> {
	const seen = new Map<string, number>();
	const deadline = Date.now() + 30000;
	const queue = queueFor<CallbackMessage>("callbacks.fifo");
	while (Date.now() < deadline) {
		for (const message of await queue.poll(10, 1)) {
			const key = message.body.requestId;
			seen.set(key, (seen.get(key) ?? 0) + 1);
			await queue.ack(message);
		}
		if ([...expected].every(([requestId, count]) => (seen.get(requestId) ?? 0) >= count)) {
			break;
		}
	}
	return seen;
}

describe("worker e2e against LocalStack and Mongo", () => {
	let h1080: MediaAsset;
	let h300: MediaAsset;
	let noAudio: MediaAsset;
	let image: MediaAsset;
	const requestIds: Record<string, string> = {};

	beforeAll(async () => {
		await bootstrap(local.e2eQueuePrefix, [local.mediaBucket, local.sourceBucket]);
		await initDb(local.mongoUri);
		await ensureIndexes();
		await accounts().insertOne({
			_id: accountId,
			slug,
			name: "E2E",
			sourceBuckets: [local.sourceBucket],
			webhookSecret: "e2e",
			features: { peopleAttributes: false },
			createdAt: new Date()
		});
		h1080 = await createAsset("h1080_16x9.mp4", videoMetadata("h1080_16x9.mp4"));
		h300 = await createAsset("h300.mp4", videoMetadata("h300.mp4"));
		noAudio = await createAsset("noaudio_720.mp4", videoMetadata("noaudio_720.mp4"));
		image = await createAsset(IMAGE_FIXTURE.name, imageMetadata());
	});

	afterAll(async () => {
		await Promise.all([
			mediaAssets().deleteMany({ accountId }),
			requests().deleteMany({ accountId }),
			pipelineItems().deleteMany({ accountId }),
			jobReports().deleteMany({ accountId }),
			usageDaily().deleteMany({ accountId }),
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

	it("encodes every asset kind through the queues and writes outputs, usage and callbacks", async () => {
		const assets: [string, MediaAsset][] = [
			["h1080", h1080],
			["h300", h300],
			["noAudio", noAudio],
			["image", image]
		];
		for (const [label, asset] of assets) {
			const { request } = await createRequest({
				asset,
				mode: "encode",
				preset: genericPreset,
				postProcess: POST_PROCESS_OFF,
				analyze: "sync"
			});
			requestIds[label] = request._id;
		}
		await drainUntilTerminal(Object.values(requestIds));

		for (const requestId of Object.values(requestIds)) {
			expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
		}
		for (const [label] of assets) {
			expect(await jobReports().findOne({ requestId: requestIds[label] })).toMatchObject({
				status: "COMPLETE",
				usage: { byTier: { fargate: { attempts: expect.any(Number) } } }
			});
			expect(
				(await jobReports().findOne({ requestId: requestIds[label] }))?.resourceUnits.fargateVcpuSeconds
			).toBeGreaterThan(0);
		}

		const h1080Keys = await outputKeys(h1080._id);
		expect(h1080Keys).toEqual(expect.arrayContaining([`${h1080._id}.mp4`, `${h1080._id}.mp3`]));
		expect(h1080Keys.filter((key) => key.startsWith("tmb/"))).toHaveLength(
			Math.ceil(H1080_DURATION_SEC / FRAME_INTERVAL_SEC)
		);
		expect(await assetDoc(h1080._id)).toMatchObject({
			outputs: expect.objectContaining({
				mp4_360: expect.any(Object),
				stills: expect.any(Object),
				audio: expect.any(Object),
				mp4_1080: expect.any(Object)
			}),
			activeStill: { index: 0, timestampSec: 0, selectedByUser: false }
		});

		const h300Keys = await outputKeys(h300._id);
		expect(h300Keys).toEqual(expect.arrayContaining([`${h300._id}.mp4`, `${h300._id}.mp3`]));
		expect(h300Keys.some((key) => key.includes("_720_"))).toBe(false);
		expect(Object.keys((await assetDoc(h300._id)).outputs).sort()).toEqual(["audio", "mp4_360", "stills"]);

		expect(Object.keys((await assetDoc(noAudio._id)).outputs).sort()).toEqual(["mp4_360", "mp4_720", "stills"]);
		expect((await outputKeys(noAudio._id)).some((key) => key.endsWith(".mp3"))).toBe(false);

		const imageKeys = await outputKeys(image._id);
		expect(imageKeys).toEqual(expect.arrayContaining([`${image._id}.jpg`, "tmb/0001.jpg"]));
		expect(Object.keys((await assetDoc(image._id)).outputs).sort()).toEqual(["image", "image_still"]);

		const expectedCallbacks = new Map(
			await Promise.all(
				Object.values(requestIds).map(async (requestId) => {
					const items = await pipelineItems().countDocuments({ requestId });
					return [requestId, items + 1] as const;
				})
			)
		);
		const received = await callbackRequestIds(expectedCallbacks);
		for (const [requestId, count] of expectedCallbacks) {
			expect(received.get(requestId)).toBeGreaterThanOrEqual(count);
		}
	});

	it("re-encodes with the stored active still kept at its timestamp and bumps the asset version", async () => {
		await mediaAssets().updateOne(
			{ _id: h1080._id, accountId },
			{ $set: { activeStill: { index: 0, timestampSec: 6, selectedByUser: true } } }
		);
		const asset = await assetDoc(h1080._id);
		const { request } = await createRequest({
			asset,
			mode: "reencode",
			preset: genericPreset,
			postProcess: POST_PROCESS_OFF,
			analyze: "sync"
		});
		await drainUntilTerminal([request._id]);

		expect(await requests().findOne({ _id: request._id })).toMatchObject({ status: "COMPLETE", assetVersion: 2 });
		expect(await assetDoc(h1080._id)).toMatchObject({
			version: 2,
			activeStill: { index: 2, timestampSec: 6, selectedByUser: true }
		});
	});
});
