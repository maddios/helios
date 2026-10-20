import { ForbiddenError, NotFoundError, ValidationError } from "@helios/contracts";
import {
	encodingPresets,
	ensureIndexes,
	files,
	mediaAssets,
	requests,
	type Account,
	type FileRecord
} from "../../src/models";
import { createEncode, reencode } from "../../src/intake";
import { probeSource } from "../../src/analyze/probe";
import { objectStore } from "../../src/storage";
import { UnprocessableSourceError } from "../../src/ssrf";
import { genericPreset } from "../../src/presets";
import { resetDb, startMongo, stopMongo } from "../helpers/mongo";
import { asset, videoSource } from "../helpers/pipelineFixtures";

jest.mock("../../src/queue", () => require("../helpers/queueMock"));
jest.mock("../../src/storage", () => ({ ...jest.requireActual("../../src/storage"), objectStore: jest.fn() }));
jest.mock("../../src/analyze/probe", () => ({ probeSource: jest.fn() }));

process.env.FFPROBE_PATH = "ffprobe";
process.env.ANALYZE_TIMEOUT_SEC = "10";
process.env.SOURCE_URL_TTL_SEC = "3600";
process.env.MAX_INGEST_BYTES = "524288000";

const headObject = jest.fn();
const presignGet = jest.fn();

const ACCOUNT: Account = {
	_id: "account-1",
	slug: "acme",
	name: "Acme",
	sourceBuckets: ["partner-bucket"],
	webhookSecret: "whsec_test",
	features: { peopleAttributes: false },
	createdAt: new Date()
};
const FILE_ID = "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const FILE_KEY = `acme/files/${FILE_ID}/clip.mp4`;
const S3_SOURCE = { bucket: "partner-bucket", key: "videos/clip.mp4" };

async function insertFile(overrides: Partial<FileRecord> = {}): Promise<void> {
	await files().insertOne({
		_id: FILE_ID,
		accountId: ACCOUNT._id,
		key: FILE_KEY,
		filename: "clip.mp4",
		status: "STORED",
		source: "upload",
		policy: { allowedContentTypes: ["*/*"], maxBytes: 1024 },
		contentType: "video/mp4",
		sizeBytes: 10,
		createdAt: new Date(),
		...overrides
	});
}

function encodeInput(overrides: Record<string, unknown> = {}) {
	return { source: S3_SOURCE, preset: genericPreset.name, analyze: "async" as const, ...overrides };
}

describe("intake", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await encodingPresets().insertOne({
			...genericPreset,
			_id: "preset-generic",
			accountId: null,
			createdAt: new Date(),
			updatedAt: new Date()
		} as never);
		headObject.mockReset().mockResolvedValue(true);
		presignGet.mockReset().mockResolvedValue("https://signed.test/source");
		jest.mocked(objectStore).mockReturnValue({ headObject, presignGet } as never);
		jest.mocked(probeSource).mockReset().mockResolvedValue(videoSource);
	});

	describe("createEncode", () => {
		it("rejects an s3 source bucket outside the account allowlist", async () => {
			await expect(createEncode(ACCOUNT, encodeInput({ source: { bucket: "other", key: "a.mp4" } }))).rejects.toThrow(
				ForbiddenError
			);
		});

		it("rejects the media bucket even when the account lists it", async () => {
			const account = { ...ACCOUNT, sourceBuckets: ["helios-test-media"] };

			await expect(
				createEncode(account, encodeInput({ source: { bucket: "helios-test-media", key: "a.mp4" } }))
			).rejects.toThrow(ForbiddenError);
		});

		it("rejects a file id the account does not own with 404", async () => {
			await insertFile();

			await expect(
				createEncode({ ...ACCOUNT, _id: "account-2" }, encodeInput({ source: { fileId: FILE_ID } }))
			).rejects.toThrow(NotFoundError);
		});

		it("rejects a file that is not stored yet with file_not_stored", async () => {
			await insertFile({ status: "PENDING" });

			await expect(createEncode(ACCOUNT, encodeInput({ source: { fileId: FILE_ID } }))).rejects.toMatchObject({
				code: "file_not_stored",
				httpStatus: 422
			});
		});

		it("rejects a source object that does not exist with source_not_found", async () => {
			headObject.mockResolvedValue(false);

			await expect(createEncode(ACCOUNT, encodeInput())).rejects.toMatchObject({
				code: "source_not_found",
				httpStatus: 422
			});
			expect(await mediaAssets().countDocuments({})).toBe(0);
		});

		it("rejects analyze sync with a url source", async () => {
			await expect(
				createEncode(ACCOUNT, encodeInput({ source: { url: "https://example.test/a.mp4" }, analyze: "sync" }))
			).rejects.toThrow(ValidationError);
		});

		it("encodes one stored file into several assets, each recording the file as its source", async () => {
			await insertFile();

			await createEncode(ACCOUNT, encodeInput({ source: { fileId: FILE_ID } }));
			await createEncode(ACCOUNT, encodeInput({ source: { fileId: FILE_ID } }));

			expect(await mediaAssets().countDocuments({ "source.type": "file", "source.fileId": FILE_ID })).toBe(2);
			expect((await mediaAssets().findOne({ "source.type": "file" }))?.source).toEqual({
				type: "file",
				fileId: FILE_ID,
				key: FILE_KEY
			});
		});

		it("returns the same request for a repeated requestId without a second asset", async () => {
			const requestId = "11111111-2222-4333-8444-555555555555";
			const first = (await createEncode(ACCOUNT, encodeInput({ requestId }))).request;

			const second = (await createEncode(ACCOUNT, encodeInput({ requestId }))).request;

			expect(second._id).toBe(first._id);
			expect(await mediaAssets().countDocuments({})).toBe(1);
		});

		it("returns the ERROR request with its code when a sync analysis fails", async () => {
			jest.mocked(probeSource).mockRejectedValue(new UnprocessableSourceError("Source has no video or image stream"));

			const { request } = await createEncode(ACCOUNT, encodeInput({ analyze: "sync" }));

			expect(request).toMatchObject({
				status: "ERROR",
				error: { code: "unprocessable_source", message: "Source has no video or image stream" }
			});
			expect(await requests().countDocuments({ _id: request._id, status: "ERROR" })).toBe(1);
		});
	});

	describe("reencode", () => {
		it("throws NotFoundError for a tombstoned asset", async () => {
			await mediaAssets().insertOne({ ...asset, accountId: ACCOUNT._id, deletedAt: new Date() });

			await expect(reencode(ACCOUNT, asset._id, { refreshPreset: false })).rejects.toThrow(NotFoundError);
		});
	});
});
