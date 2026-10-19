import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import {
	ensureIndexes,
	listTranscriptViews,
	mediaAssets,
	removeStaleTranscripts,
	resetObjectStoreForTests,
	storeTranscript,
	transcripts
} from "../../src/index";
import { resetDb, startMongo, stopMongo } from "../helpers/mongo";

const s3Mock = mockClient(S3Client);
const SEGMENTS = [
	{ start: 0, end: 2, text: "Hola" },
	{ start: 2, end: 4, text: "2024" }
];
const INPUT = {
	slug: "acme",
	asset: { _id: "asset-1", accountId: "acct-1" },
	language: "es",
	isTranslation: false,
	segments: SEGMENTS,
	durationSec: 4,
	model: "whisper-1"
};
const TRANSLATION = {
	...INPUT,
	language: "en",
	isTranslation: true,
	segments: [{ start: 0, end: 2, text: "Hello" }]
};

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	s3Mock.reset();
	s3Mock.on(PutObjectCommand).resolves({});
	s3Mock.on(DeleteObjectsCommand).resolves({ Deleted: [] });
	resetObjectStoreForTests();
});

function uploads(): { Key: string; ContentType: string; Body: string }[] {
	return s3Mock.commandCalls(PutObjectCommand).map(({ args }) => {
		const { Key, ContentType, Body } = args[0].input;
		return { Key: Key ?? "", ContentType: ContentType ?? "", Body: String(Body) };
	});
}

function deletedKeys(): string[] {
	return s3Mock
		.commandCalls(DeleteObjectsCommand)
		.flatMap(({ args }) => (args[0].input.Delete?.Objects ?? []).map((object) => object.Key ?? ""));
}

describe("storeTranscript", () => {
	it("uploads SRT, VTT and TXT under the transcript prefix with their content types", async () => {
		const { keys } = await storeTranscript(INPUT);

		expect(keys).toEqual({
			srt: "acme/media/asset-1/transcript/es.srt",
			vtt: "acme/media/asset-1/transcript/es.vtt",
			txt: "acme/media/asset-1/transcript/es.txt"
		});
		expect(uploads()).toEqual(
			expect.arrayContaining([
				{
					Key: keys.srt,
					ContentType: "application/x-subrip",
					Body: expect.stringContaining("00:00:00,000 --> 00:00:02,000")
				},
				{ Key: keys.vtt, ContentType: "text/vtt", Body: expect.stringMatching(/^WEBVTT/) },
				{ Key: keys.txt, ContentType: "text/plain", Body: "Hola\n2024" }
			])
		);
	});

	it("keys a translation separately from its native track", async () => {
		const { keys } = await storeTranscript(TRANSLATION);

		expect(keys.srt).toBe("acme/media/asset-1/transcript/en.translated.srt");
	});

	it("upserts one row per asset, language and track, bumping the revision on each write", async () => {
		const first = await storeTranscript(INPUT);
		const created = await transcripts().findOne({ assetId: "asset-1" });
		const second = await storeTranscript({ ...INPUT, segments: [{ start: 0, end: 1, text: "Adios" }], durationSec: 1 });

		const rows = await transcripts().find({ assetId: "asset-1" }).toArray();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			_id: created?._id,
			accountId: "acct-1",
			language: "es",
			isTranslation: false,
			text: "Adios",
			durationSec: 1,
			model: "whisper-1",
			revision: 2
		});
		expect(rows[0].createdAt).toEqual(created?.createdAt);
		expect([first.revision, second.revision]).toEqual([1, 2]);
	});

	it("keeps a native track and its translation as separate rows", async () => {
		await storeTranscript(INPUT);
		await storeTranscript(TRANSLATION);

		const rows = await transcripts().find({ assetId: "asset-1" }).toArray();
		expect(rows.map((row) => [row.language, row.isTranslation]).sort()).toEqual([
			["en", true],
			["es", false]
		]);
	});

	it("lists stored transcripts with CDN urls at the stored revision", async () => {
		await mediaAssets().insertOne({
			_id: "asset-1",
			accountId: "acct-1",
			source: { type: "s3", bucket: "source-bucket", key: "source.mp4" },
			version: 4,
			outputs: {},
			createdAt: new Date(),
			updatedAt: new Date()
		});
		await storeTranscript(INPUT);

		const [view] = await listTranscriptViews({ slug: "acme", accountId: "acct-1", assetId: "asset-1" });

		expect(view).toMatchObject({ language: "es", text: "Hola\n2024" });
		expect(view.urls).toEqual({
			srt: "https://cdn.test.invalid/helios-test-media/acme/media/asset-1/transcript/es.srt?v=1",
			vtt: "https://cdn.test.invalid/helios-test-media/acme/media/asset-1/transcript/es.vtt?v=1",
			txt: "https://cdn.test.invalid/helios-test-media/acme/media/asset-1/transcript/es.txt?v=1"
		});
	});

	it("removes stale rows and their files, and keeps the tracks of this output", async () => {
		await storeTranscript(INPUT);
		await storeTranscript(TRANSLATION);

		await removeStaleTranscripts("acme", "asset-1", [{ language: "en", isTranslation: true }]);

		expect(await transcripts().find({ assetId: "asset-1" }).toArray()).toMatchObject([
			{ language: "en", isTranslation: true }
		]);
		expect(deletedKeys().sort()).toEqual([
			"acme/media/asset-1/transcript/es.srt",
			"acme/media/asset-1/transcript/es.txt",
			"acme/media/asset-1/transcript/es.vtt"
		]);
	});

	it("does nothing to storage when every row belongs to this output", async () => {
		await storeTranscript(INPUT);

		await removeStaleTranscripts("acme", "asset-1", [{ language: "es", isTranslation: false }]);

		expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
		expect(await transcripts().countDocuments({ assetId: "asset-1" })).toBe(1);
	});
});
