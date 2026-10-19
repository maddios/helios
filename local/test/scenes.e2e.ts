import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Preset, VideoSourceMetadata } from "@helios/contracts";
import {
	Account,
	accounts,
	CHAT_MODELS,
	closeDb,
	createRequest,
	ensureIndexes,
	genericPreset,
	initDb,
	jobReports,
	mediaAssets,
	objectStore,
	pipelineItems,
	requests,
	sceneAnalyses,
	type SceneAnalysis,
	transcripts,
	usageDaily,
	UsageMeter,
	type MediaAsset,
	type PipelineItem,
	type PipelineRequest
} from "@helios/core";
import { resetConfigForTests } from "../../worker/src/config";
import { scenesHandler } from "../../worker/src/handlers/scenes";
import { bootstrap } from "../bootstrap";
import { FIXTURE_DIR, VIDEO_FIXTURES } from "../fixtures";
import { loadLocalConfig } from "../loadConfig";
import { startOpenAiMock, type OpenAiMock } from "../openaiMock";
import { drainUntilTerminal } from "./drain";

process.env.LOG_LEVEL = "warn";
jest.setTimeout(900000);

const local = loadLocalConfig();
const SHORT_FIXTURE = "h1080_16x9.mp4";
const LONG_FIXTURE = "long_1080.mp4";
const SOURCE_LANGUAGE = "spanish";
const CHAT_PATH = "/v1/chat/completions";
const MOCK_SCENE_STRIDE = 3;
const LONG_WINDOW_SEC = 60;
const ENCODE_PRESET: Preset = {
	...genericPreset,
	profiles: genericPreset.profiles.filter((profile) => ["mp4_360", "stills"].includes(profile.name))
};

const s3 = new S3Client({ region: local.awsRegion, endpoint: local.awsEndpoint, forcePathStyle: true });
const created: { accountId: string; slug: string; sourceKeys: string[] }[] = [];
let mock: OpenAiMock;
let withPeople: { accountId: string; slug: string; sourceKeys: string[] };
let withoutPeople: { accountId: string; slug: string; sourceKeys: string[] };
let shortAssetId: string;
let shortRequestId: string;

function setSceneWindow(windowSec: number): void {
	Object.assign(process.env, { SCENES_WINDOW_SEC: String(windowSec) });
	resetConfigForTests();
}

async function createAccount(peopleAttributes: boolean) {
	const accountId = `e2e-${randomUUID()}`;
	const slug = `e2e-${accountId.slice(4, 12)}`;
	await accounts().insertOne({
		_id: accountId,
		slug,
		name: "E2E",
		sourceBuckets: [local.sourceBucket],
		webhookSecret: "e2e",
		features: { peopleAttributes },
		createdAt: new Date()
	});
	const account = { accountId, slug, sourceKeys: [] as string[] };
	created.push(account);
	return account;
}

function fixtureNamed(name: string) {
	const fixture = VIDEO_FIXTURES.find((candidate) => candidate.name === name);
	if (fixture === undefined) {
		throw new Error(`unknown fixture ${name}`);
	}
	return fixture;
}

async function createAsset(account: { accountId: string; sourceKeys: string[] }, name: string): Promise<MediaAsset> {
	const fixture = fixtureNamed(name);
	const sourceKey = `e2e/${account.accountId}/${name}`;
	await s3.send(
		new PutObjectCommand({
			Bucket: local.sourceBucket,
			Key: sourceKey,
			Body: fs.readFileSync(path.join(FIXTURE_DIR, name))
		})
	);
	account.sourceKeys.push(sourceKey);
	const sourceMetadata: VideoSourceMetadata = {
		type: "video",
		sizeBytes: fs.statSync(path.join(FIXTURE_DIR, name)).size,
		width: fixture.width,
		height: fixture.height,
		durationSec: fixture.durationSec,
		fps: 30,
		videoCodec: "h264",
		hasAudio: fixture.hasAudio
	};
	const asset: MediaAsset = {
		_id: randomUUID(),
		accountId: account.accountId,
		source: { type: "s3", bucket: local.sourceBucket, key: sourceKey },
		sourceMetadata,
		presetName: genericPreset.name,
		presetVersion: genericPreset.version,
		presetSnapshot: ENCODE_PRESET,
		version: 1,
		outputs: {},
		createdAt: new Date(),
		updatedAt: new Date()
	};
	await mediaAssets().insertOne(asset);
	return asset;
}

async function freshAsset(asset: MediaAsset): Promise<MediaAsset> {
	const found = await mediaAssets().findOne({ _id: asset._id, accountId: asset.accountId });
	if (found === null) {
		throw new Error(`Asset ${asset._id} missing`);
	}
	return found;
}

async function runEncode(
	asset: MediaAsset,
	postProcess: { transcribe: boolean; sceneDetection: boolean }
): Promise<string> {
	const { request } = await createRequest({
		asset: await freshAsset(asset),
		mode: "encode",
		preset: ENCODE_PRESET,
		postProcess,
		analyze: "sync"
	});
	await drainUntilTerminal([request._id]);
	return request._id;
}

async function analysesOf(assetId: string): Promise<SceneAnalysis[]> {
	return sceneAnalyses().find({ assetId }).toArray();
}

function durationOf(asset: MediaAsset): number {
	if (asset.sourceMetadata?.type !== "video") {
		throw new Error(`Asset ${asset._id} is not a video`);
	}
	return asset.sourceMetadata.durationSec;
}

function stillTimesOf(asset: MediaAsset): number[] {
	return (asset.outputs.stills?.items ?? []).map((item) => item.timestampSec);
}

function expectCoverage(scenes: SceneAnalysis["scenes"], durationSec: number): void {
	expect(scenes[0].startSec).toBe(0);
	expect(scenes.at(-1)?.endSec).toBe(durationSec);
	for (const [index, scene] of scenes.entries()) {
		expect(scene.sceneNumber).toBe(index + 1);
		expect(scene.endSec).toBeGreaterThan(scene.startSec);
		if (index > 0) {
			expect(scenes[index - 1].endSec).toBe(scene.startSec);
		}
	}
}

function expectedStitchedScenes(timesSec: number[], windowSec: number): number {
	const stillsPerWindow = new Map<number, number>();
	for (const timestampSec of timesSec) {
		const window = Math.floor(timestampSec / windowSec);
		stillsPerWindow.set(window, (stillsPerWindow.get(window) ?? 0) + 1);
	}
	const counts = [...stillsPerWindow.values()];
	const perWindow = counts.reduce((total, count) => total + Math.ceil(count / MOCK_SCENE_STRIDE), 0);
	return perWindow - (counts.length - 1);
}

describe("scenes e2e against LocalStack, Mongo and the OpenAI mock", () => {
	beforeAll(async () => {
		await bootstrap(local.e2eQueuePrefix, [local.mediaBucket, local.sourceBucket], local.worker.visibilityExtensionSec);
		await initDb(local.mongoUri);
		await ensureIndexes();
		mock = await startOpenAiMock({ port: local.openai.e2eMockPort, language: SOURCE_LANGUAGE });
		withPeople = await createAccount(true);
		withoutPeople = await createAccount(false);
	});

	afterAll(async () => {
		const accountIds = created.map((account) => account.accountId);
		await Promise.all([
			mediaAssets().deleteMany({ accountId: { $in: accountIds } }),
			requests().deleteMany({ accountId: { $in: accountIds } }),
			pipelineItems().deleteMany({ accountId: { $in: accountIds } }),
			transcripts().deleteMany({ accountId: { $in: accountIds } }),
			sceneAnalyses().deleteMany({ accountId: { $in: accountIds } }),
			jobReports().deleteMany({ accountId: { $in: accountIds } }),
			usageDaily().deleteMany({ accountId: { $in: accountIds } }),
			accounts().deleteMany({ _id: { $in: accountIds } })
		]);
		for (const account of created) {
			await objectStore().deleteKeys(await objectStore().listKeys(`${account.slug}/`));
			for (const sourceKey of account.sourceKeys) {
				await s3.send(
					new DeleteObjectsCommand({ Bucket: local.sourceBucket, Delete: { Objects: [{ Key: sourceKey }] } })
				);
			}
		}
		await mock.close();
		await closeDb();
		setSceneWindow(local.worker.scenes.windowSec);
	});

	it("stores ordered scenes covering the video, with the English transcript and people attributes", async () => {
		const asset = await createAsset(withPeople, SHORT_FIXTURE);
		shortAssetId = asset._id;
		shortRequestId = await runEncode(asset, { transcribe: true, sceneDetection: true });

		expect(await requests().findOne({ _id: shortRequestId })).toMatchObject({ status: "COMPLETE" });
		const [analysis] = await analysesOf(asset._id);
		const stills = (await freshAsset(asset)).outputs.stills?.items ?? [];
		expect(analysis).toMatchObject({
			promptVersion: "scenes-v2",
			model: CHAT_MODELS[local.worker.scenes.effort],
			transcriptLanguage: "en"
		});
		expect(analysis.scenes).toHaveLength(Math.ceil(stills.length / MOCK_SCENE_STRIDE));
		expectCoverage(analysis.scenes, durationOf(asset));
		expect(analysis.scenes.every((scene) => scene.people.length === 1)).toBe(true);
		expect(analysis.summary.title).toBe("Mock title");
		for (const scene of analysis.scenes) {
			expect(await objectStore().headObject(local.mediaBucket, stills[scene.representativeStillIndex].key)).toBe(true);
		}

		const item = await pipelineItems().findOne({ requestId: shortRequestId, kind: "scenes" });
		expect(item?.output?.scenes).toEqual({ sceneCount: analysis.scenes.length, title: "Mock title" });
	});

	it("reruns the same scenes item without duplicating its analysis", async () => {
		const asset = await freshAsset({ _id: shortAssetId, accountId: withPeople.accountId } as MediaAsset);
		const item = (await pipelineItems().findOne({ requestId: shortRequestId, kind: "scenes" })) as PipelineItem;
		const request = (await requests().findOne({ _id: shortRequestId })) as PipelineRequest;

		await scenesHandler({
			item,
			request,
			asset,
			account: (await accounts().findOne({ _id: withPeople.accountId })) as Account,
			workDir: path.join(local.worker.workDir, item._id),
			signal: new AbortController().signal,
			meter: new UsageMeter(),
			reportProgress: () => undefined
		});

		expect(await sceneAnalyses().countDocuments({ assetId: asset._id, itemId: item._id })).toBe(1);
		expect(await analysesOf(asset._id)).toHaveLength(1);
	});

	it("stitches the scenes of a long video processed in windows", async () => {
		setSceneWindow(LONG_WINDOW_SEC);
		const asset = await createAsset(withPeople, LONG_FIXTURE);
		const chatCallsBefore = mock.requestCount(CHAT_PATH);

		const requestId = await runEncode(asset, { transcribe: false, sceneDetection: true });

		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
		const stored = await freshAsset(asset);
		const durationSec = durationOf(stored);
		const windows = Math.ceil(durationSec / LONG_WINDOW_SEC);
		const [analysis] = await analysesOf(asset._id);
		expect(mock.requestCount(CHAT_PATH) - chatCallsBefore).toBe(windows + 1);
		expect(analysis.scenes).toHaveLength(expectedStitchedScenes(stillTimesOf(stored), LONG_WINDOW_SEC));
		expectCoverage(analysis.scenes, durationSec);
		expect(analysis.transcriptLanguage).toBeNull();
		setSceneWindow(local.worker.scenes.windowSec);
	});

	it("omits people and stores empty people lists when the account disables people attributes", async () => {
		const asset = await createAsset(withoutPeople, SHORT_FIXTURE);

		const requestId = await runEncode(asset, { transcribe: false, sceneDetection: true });

		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
		const [analysis] = await analysesOf(asset._id);
		expect(analysis.scenes.length).toBeGreaterThan(0);
		expect(analysis.scenes.every((scene) => scene.people.length === 0)).toBe(true);
		expect(analysis.summary.people).toEqual([]);
	});

	it("never merges a scene that continues mid-window, since only a window's first scene can", async () => {
		const asset = await createAsset(withPeople, SHORT_FIXTURE);
		mock.setSceneContinuation("mid-window");

		try {
			const requestId = await runEncode(asset, { transcribe: false, sceneDetection: true });

			expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
			const [analysis] = await analysesOf(asset._id);
			const stills = stillTimesOf(await freshAsset(asset));
			expect(analysis.scenes).toHaveLength(Math.ceil(stills.length / MOCK_SCENE_STRIDE));
			expectCoverage(analysis.scenes, durationOf(asset));
		} finally {
			mock.setSceneContinuation("window-start");
		}
	});

	it("runs on stills only when transcription is disabled", async () => {
		const asset = await createAsset(withPeople, SHORT_FIXTURE);

		const requestId = await runEncode(asset, { transcribe: false, sceneDetection: true });

		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
		const [analysis] = await analysesOf(asset._id);
		expect(analysis.transcriptLanguage).toBeNull();
		expect(analysis.scenes.every((scene) => scene.transcriptExcerpt === null)).toBe(true);
		expect(await transcripts().countDocuments({ assetId: asset._id })).toBe(0);
	});
});
