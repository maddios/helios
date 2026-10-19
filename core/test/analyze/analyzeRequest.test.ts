import { analyzeRequest } from "../../src/analyze";
import { UnprocessableSourceError, UnsafeUrlError } from "../../src/ssrf";
import { probeSource } from "../../src/analyze/probe";
import { accounts, mediaAssets, requests, ensureIndexes, type MediaAsset } from "../../src/models";
import { createRequest } from "../../src/pipeline";
import { ingestUrl } from "../../src/ingest";
import { objectStore } from "../../src/storage";
import { resetDb, startMongo, stopMongo } from "../helpers/mongo";
import { asset, createInput, sentCallbacks, unanalyzedAsset, videoSource } from "../helpers/pipelineFixtures";

jest.mock("../../src/analyze/probe", () => ({ probeSource: jest.fn() }));
jest.mock("../../src/ingest", () => ({ ingestUrl: jest.fn() }));
jest.mock("../../src/storage", () => ({ ...jest.requireActual("../../src/storage"), objectStore: jest.fn() }));
jest.mock("../../src/queue", () => require("../helpers/queueMock"));

process.env.FFPROBE_PATH = "ffprobe";
process.env.ANALYZE_TIMEOUT_SEC = "10";
process.env.SOURCE_URL_TTL_SEC = "3600";
process.env.MAX_INGEST_BYTES = "524288000";

const SIGNED_URL = "https://signed.test/source";
const URL_ASSET: MediaAsset = {
	...unanalyzedAsset,
	_id: "asset-url",
	source: { type: "url", url: "https://example.test/clip.mp4" }
};
const INGESTED_KEY = "acme/sources/asset-url/original";

const presignGet = jest.fn();

async function insertAnalyzingRequest(input: MediaAsset): Promise<string> {
	await mediaAssets().insertOne(input);
	const { request } = await createRequest(createInput({ asset: input, analyze: "async" }));
	return request._id;
}

async function requestOf(requestId: string) {
	return requests().findOne({ _id: requestId });
}

describe("analyzeRequest", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await accounts().insertOne({
			_id: "account-1",
			slug: "acme",
			name: "Acme",
			sourceBuckets: [],
			webhookSecret: "whsec_test",
			features: { peopleAttributes: false },
			createdAt: new Date()
		});
		presignGet.mockReset().mockResolvedValue(SIGNED_URL);
		jest.mocked(objectStore).mockReturnValue({ presignGet } as never);
		jest.mocked(probeSource).mockReset().mockResolvedValue(videoSource);
		jest.mocked(ingestUrl).mockReset().mockResolvedValue(INGESTED_KEY);
	});

	it("probes an s3 source, stores its metadata and launches the request", async () => {
		const requestId = await insertAnalyzingRequest(unanalyzedAsset);

		await analyzeRequest(requestId);

		expect(presignGet).toHaveBeenCalledWith("bucket", "raw.mp4", 3600);
		expect(probeSource).toHaveBeenCalledWith(SIGNED_URL);
		expect(await mediaAssets().findOne({ _id: unanalyzedAsset._id })).toMatchObject({ sourceMetadata: videoSource });
		expect(await requestOf(requestId)).toMatchObject({ status: "IN_PROGRESS", enqueuedAt: expect.any(Date) });
	});

	it("does nothing when called again after the request has been launched", async () => {
		const requestId = await insertAnalyzingRequest(unanalyzedAsset);
		await analyzeRequest(requestId);
		const launched = await requestOf(requestId);

		await analyzeRequest(requestId);

		expect(probeSource).toHaveBeenCalledTimes(1);
		expect(await requestOf(requestId)).toEqual(launched);
	});

	it("launches without probing when sourceMetadata was stored before a crash", async () => {
		const requestId = await insertAnalyzingRequest(unanalyzedAsset);
		await mediaAssets().updateOne({ _id: unanalyzedAsset._id }, { $set: { sourceMetadata: videoSource } });

		await analyzeRequest(requestId);

		expect(probeSource).not.toHaveBeenCalled();
		expect(await requestOf(requestId)).toMatchObject({ status: "IN_PROGRESS" });
	});

	it("fails the request with the probe error for an unprocessable source", async () => {
		const requestId = await insertAnalyzingRequest(unanalyzedAsset);
		jest.mocked(probeSource).mockRejectedValue(new UnprocessableSourceError("Source has no video or image stream"));

		await analyzeRequest(requestId);

		expect(await requestOf(requestId)).toMatchObject({
			status: "ERROR",
			error: { code: "unprocessable_source", message: "Source has no video or image stream" }
		});
		expect(await mediaAssets().findOne({ _id: unanalyzedAsset._id })).not.toHaveProperty("sourceMetadata");
		expect(sentCallbacks()).toEqual([{ type: "request", requestId, sequence: 1 }]);
	});

	it("ingests a url source before probing it", async () => {
		const requestId = await insertAnalyzingRequest(URL_ASSET);

		await analyzeRequest(requestId);

		expect(ingestUrl).toHaveBeenCalledWith(expect.objectContaining({ _id: "asset-url" }), "acme", {
			maxBytes: 524288000
		});
		expect(presignGet).toHaveBeenCalledWith("helios-test-media", INGESTED_KEY, 3600);
		expect(jest.mocked(ingestUrl).mock.invocationCallOrder[0]).toBeLessThan(
			jest.mocked(probeSource).mock.invocationCallOrder[0]
		);
		expect(await requestOf(requestId)).toMatchObject({ status: "IN_PROGRESS" });
	});

	it("fails the request when the url is unsafe and does not probe", async () => {
		const requestId = await insertAnalyzingRequest(URL_ASSET);
		jest.mocked(ingestUrl).mockRejectedValue(new UnsafeUrlError("Host resolves to a private address"));

		await analyzeRequest(requestId);

		expect(await requestOf(requestId)).toMatchObject({
			status: "ERROR",
			error: { code: "unsafe_url", message: "Host resolves to a private address" }
		});
		expect(probeSource).not.toHaveBeenCalled();
	});

	it("is a no-op for a request already past analysis", async () => {
		await mediaAssets().insertOne(asset);
		const { request } = await createRequest(createInput({ analyze: "sync" }));
		const before = await requestOf(request._id);

		await analyzeRequest(request._id);

		expect(probeSource).not.toHaveBeenCalled();
		expect(await requestOf(request._id)).toEqual(before);
	});
});
