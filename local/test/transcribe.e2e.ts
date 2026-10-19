import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Preset, TranscriptSegment, VideoSourceMetadata } from "@helios/contracts";
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
	requests,
	transcripts,
	usageDaily,
	type MediaAsset
} from "@helios/core";
import { resetConfigForTests } from "../../worker/src/config";
import { bootstrap } from "../bootstrap";
import { FIXTURE_DIR, VIDEO_FIXTURES } from "../fixtures";
import { loadLocalConfig } from "../loadConfig";
import { startOpenAiMock, type OpenAiMock } from "../openaiMock";
import { drainUntilTerminal } from "./drain";

process.env.LOG_LEVEL = "warn";
jest.setTimeout(900000);

const local = loadLocalConfig();
const FIXTURE = "long_1080.mp4";
const SOURCE_LANGUAGE = "spanish";
const CHAT_PATH = "/v1/chat/completions";
const TRANSCRIPTION_PATH = "/v1/audio/transcriptions";
const POST_PROCESS = { transcribe: true, sceneDetection: false } as const;
const ENCODE_PRESET: Preset = {
	...genericPreset,
	profiles: genericPreset.profiles.filter((profile) => ["mp4_360", "stills", "audio"].includes(profile.name))
};

const accountId = `e2e-${randomUUID()}`;
const slug = `e2e-${accountId.slice(4, 12)}`;
const s3 = new S3Client({ region: local.awsRegion, endpoint: local.awsEndpoint, forcePathStyle: true });
let mock: OpenAiMock;
let asset: MediaAsset;
let sourceKey: string;

function applyTranscribeOverrides(): void {
	Object.assign(process.env, {
		TRANSCRIBE_MAX_UPLOAD_BYTES: "300000",
		TRANSCRIBE_CHUNK_SEC: "60",
		TRANSCRIBE_OVERLAP_SEC: "2"
	});
	resetConfigForTests();
}

function sourceMetadata(): VideoSourceMetadata {
	const fixture = VIDEO_FIXTURES.find((candidate) => candidate.name === FIXTURE);
	if (fixture === undefined) {
		throw new Error(`unknown fixture ${FIXTURE}`);
	}
	return {
		type: "video",
		sizeBytes: fs.statSync(path.join(FIXTURE_DIR, FIXTURE)).size,
		width: fixture.width,
		height: fixture.height,
		durationSec: fixture.durationSec,
		fps: 30,
		videoCodec: "h264",
		hasAudio: fixture.hasAudio
	};
}

async function uploadSource(): Promise<void> {
	const localPath = path.join(FIXTURE_DIR, FIXTURE);
	if (!fs.existsSync(localPath)) {
		throw new Error(`Missing fixture ${localPath}; run npm run local:fixtures`);
	}
	sourceKey = `e2e/${accountId}/${FIXTURE}`;
	await s3.send(new PutObjectCommand({ Bucket: local.sourceBucket, Key: sourceKey, Body: fs.readFileSync(localPath) }));
}

async function assetDoc(): Promise<MediaAsset> {
	const found = await mediaAssets().findOne({ _id: asset._id, accountId });
	if (found === null) {
		throw new Error(`Asset ${asset._id} missing`);
	}
	return found;
}

async function runPostProcess(mode: "encode" | "postProcess"): Promise<string> {
	const { request } = await createRequest({
		asset: await assetDoc(),
		mode,
		preset: ENCODE_PRESET,
		postProcess: POST_PROCESS,
		analyze: "sync"
	});
	await drainUntilTerminal([request._id]);
	return request._id;
}

function expectOrderedCues(segments: TranscriptSegment[]): void {
	for (const [index, segment] of segments.entries()) {
		expect(segment.end).toBeGreaterThan(segment.start);
		if (index > 0) {
			expect(segments[index - 1].end).toBeLessThanOrEqual(segment.start);
		}
	}
}

describe("transcribe e2e against LocalStack, Mongo and the OpenAI mock", () => {
	beforeAll(async () => {
		applyTranscribeOverrides();
		await bootstrap(local.e2eQueuePrefix, [local.mediaBucket, local.sourceBucket], local.worker.visibilityExtensionSec);
		await initDb(local.mongoUri);
		await ensureIndexes();
		mock = await startOpenAiMock({ port: local.openai.e2eMockPort, language: SOURCE_LANGUAGE });
		await accounts().insertOne({
			_id: accountId,
			slug,
			name: "E2E",
			sourceBuckets: [local.sourceBucket],
			webhookSecret: "e2e",
			features: { peopleAttributes: false },
			createdAt: new Date()
		});
		await uploadSource();
		asset = {
			_id: randomUUID(),
			accountId,
			source: { type: "s3", bucket: local.sourceBucket, key: sourceKey },
			sourceMetadata: sourceMetadata(),
			presetName: genericPreset.name,
			presetVersion: genericPreset.version,
			presetSnapshot: ENCODE_PRESET,
			version: 1,
			outputs: {},
			createdAt: new Date(),
			updatedAt: new Date()
		};
		await mediaAssets().insertOne(asset);
	});

	afterAll(async () => {
		await Promise.all([
			mediaAssets().deleteMany({ accountId }),
			requests().deleteMany({ accountId }),
			pipelineItems().deleteMany({ accountId }),
			transcripts().deleteMany({ accountId }),
			jobReports().deleteMany({ accountId }),
			usageDaily().deleteMany({ accountId }),
			accounts().deleteMany({ _id: accountId })
		]);
		await objectStore().deleteKeys(await objectStore().listKeys(`${slug}/`));
		await s3.send(new DeleteObjectsCommand({ Bucket: local.sourceBucket, Delete: { Objects: [{ Key: sourceKey }] } }));
		await mock.close();
		await closeDb();
		resetConfigForTests();
	});

	it("stores the native and English transcripts once, in S3 and Mongo, from chunked audio", async () => {
		const requestId = await runPostProcess("encode");

		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
		const docs = await transcripts().find({ assetId: asset._id }).toArray();
		expect(docs.map((doc) => `${doc.language}:${doc.isTranslation}`).sort()).toEqual(["en:true", "es:false"]);

		const native = docs.find((doc) => doc.language === "es");
		const english = docs.find((doc) => doc.language === "en");
		expect(native?.segments.map((segment) => segment.text)).toContain("seg 0");
		expect(english?.segments.map((segment) => segment.text)).toContain("EN: seg 0");
		expect(english?.segments.map(({ start, end }) => [start, end])).toEqual(
			native?.segments.map(({ start, end }) => [start, end])
		);
		expectOrderedCues(native?.segments ?? []);
		expectOrderedCues(english?.segments ?? []);
		expect(native?.segments.at(-1)?.start).toBeGreaterThanOrEqual(190);

		const keys = (await objectStore().listKeys(`${slug}/media/${asset._id}/transcript/`)).map((key) =>
			key.slice(`${slug}/media/${asset._id}/`.length)
		);
		expect(keys.sort()).toEqual(
			["en.translated.srt", "en.translated.txt", "en.translated.vtt", "es.srt", "es.txt", "es.vtt"].map(
				(name) => `transcript/${name}`
			)
		);
		expect(docs.map((doc) => doc.revision)).toEqual([1, 1]);

		const item = await pipelineItems().findOne({ requestId, kind: "transcribe" });
		expect(item?.output?.transcripts?.map((entry) => entry.language).sort()).toEqual(["en", "es"]);
		expect(item?.usage.some((usage) => (usage.audioSec ?? 0) > 200)).toBe(true);
	});

	it("reruns the post-process without duplicating transcript documents and removes stale tracks", async () => {
		const staleKey = `${slug}/media/${asset._id}/transcript/fr.srt`;
		await transcripts().insertOne({
			_id: randomUUID(),
			accountId,
			assetId: asset._id,
			language: "fr",
			isTranslation: false,
			segments: [],
			text: "",
			durationSec: 0,
			model: "e2e",
			revision: 1,
			createdAt: new Date()
		});
		await objectStore().uploadText(staleKey, "1", "application/x-subrip");

		await runPostProcess("postProcess");

		expect(await transcripts().countDocuments({ assetId: asset._id })).toBe(2);
		expect((await transcripts().find({ assetId: asset._id }).toArray()).map((doc) => doc.revision)).toEqual([2, 2]);
		expect(await objectStore().listKeys(staleKey)).toEqual([]);
	});

	it("succeeds after a forced 429 from the chat endpoint", async () => {
		mock.setFailures([{ path: CHAT_PATH, status: 429, times: 1 }]);

		const requestId = await runPostProcess("postProcess");

		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
		expect(await transcripts().countDocuments({ assetId: asset._id })).toBe(2);
		mock.setFailures([]);
	});

	it("succeeds after a forced 500 from the transcription endpoint", async () => {
		mock.setFailures([{ path: TRANSCRIPTION_PATH, status: 500, times: 1 }]);

		const requestId = await runPostProcess("postProcess");

		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
		mock.setFailures([]);
	});
});
