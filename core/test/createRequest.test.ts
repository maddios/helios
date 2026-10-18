import { Collection, MongoServerError } from "mongodb";
import { ensureIndexes, mediaAssets, pipelineItems, requests, type PipelineRequest } from "../src/models";
import { createRequest, RequestIdConflictError } from "../src/pipeline";
import { queueFor } from "../src/queue";
import { genericPreset } from "../src/presets";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";
import {
	asset,
	createInput,
	expectSentKeys,
	insertStoredRequest,
	totalSendCalls,
	unanalyzedAsset,
	videoSource
} from "./helpers/pipelineFixtures";

jest.mock("../src/queue", () => require("./helpers/queueMock"));

describe("createRequest", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await mediaAssets().insertOne(asset);
	});

	it("creates an analyzed request in progress with pending item ids and enqueuedAt", async () => {
		const result = await createRequest(createInput());
		expect(result.created).toBe(true);
		expect(result.request.clientRequestId).toBe("req-1");
		expect(result.request._id).not.toBe("req-1");
		expect(result.request.pendingItems).toHaveLength(6);
		expect(result.request.status).toBe("IN_PROGRESS");
		expect(result.request.enqueuedAt).toBeInstanceOf(Date);
		expect(await requests().findOne({ _id: result.request._id })).toMatchObject({
			clientRequestId: "req-1",
			pendingItems: result.request.pendingItems
		});
	});

	it("uses the generated _id as clientRequestId when the client sends none", async () => {
		const { request } = await createRequest(createInput({ requestId: undefined }));
		expect(request.clientRequestId).toBe(request._id);
	});

	it("stores an unanalyzed asset as ANALYZING with no items and no enqueue", async () => {
		await mediaAssets().insertOne(unanalyzedAsset);

		const { request, created } = await createRequest(createInput({ requestId: "req-raw", asset: unanalyzedAsset }));

		expect(created).toBe(true);
		expect(request).toMatchObject({ status: "ANALYZING", pendingItems: [], analyze: "sync", assetVersion: 1 });
		expect(request.enqueuedAt).toBeUndefined();
		expect(await requests().findOne({ _id: request._id })).toMatchObject({
			analyze: "sync",
			presetSnapshot: genericPreset,
			postProcess: { sceneDetection: genericPreset.postProcess.sceneDetection }
		});
		expect(await pipelineItems().countDocuments({})).toBe(0);
		expect(totalSendCalls()).toBe(0);
	});

	it("enqueues analyze for an async ANALYZING request on creation and again on repeat", async () => {
		await mediaAssets().insertOne(unanalyzedAsset);
		const input = createInput({ requestId: "req-async", asset: unanalyzedAsset, analyze: "async" });

		await createRequest(input);
		await createRequest(input);

		expect(queueFor("analyze").send).toHaveBeenCalledTimes(2);
		expect(await requests().findOne({ clientRequestId: "req-async" })).toMatchObject({ status: "ANALYZING" });
	});

	it("does not enqueue analyze for a sync ANALYZING request", async () => {
		await mediaAssets().insertOne(unanalyzedAsset);

		await createRequest(createInput({ requestId: "req-sync", asset: unanalyzedAsset, analyze: "sync" }));

		expect(queueFor("analyze").send).not.toHaveBeenCalled();
	});

	it("launches an ANALYZING request once its asset has been analyzed", async () => {
		await mediaAssets().insertOne(unanalyzedAsset);
		const pending = await createRequest(createInput({ requestId: "req-raw", asset: unanalyzedAsset }));
		await mediaAssets().updateOne({ _id: unanalyzedAsset._id }, { $set: { sourceMetadata: videoSource } });

		const result = await createRequest(
			createInput({ requestId: "req-raw", asset: { ...unanalyzedAsset, sourceMetadata: videoSource } })
		);

		expect(result).toMatchObject({ created: false, request: { _id: pending.request._id, status: "IN_PROGRESS" } });
		expect(result.request.enqueuedAt).toBeInstanceOf(Date);
		expectSentKeys(pending.request._id, {
			"lambda-p1": ["mp4_360"],
			"fargate-p2": ["audio", "mp4_720", "mp4_1080"],
			"lambda-ai": ["transcribe"]
		});
	});

	it("returns the existing request without writes when repeated", async () => {
		const first = await createRequest(createInput());
		const sendCalls = totalSendCalls();
		const itemCount = await pipelineItems().countDocuments({ requestId: first.request._id });

		const repeat = await createRequest(createInput());

		expect(repeat.created).toBe(false);
		expect(repeat.request._id).toBe(first.request._id);
		expect(await pipelineItems().countDocuments({ requestId: first.request._id })).toBe(itemCount);
		expect(totalSendCalls()).toBe(sendCalls);
	});

	it("does not enqueue a CANCELLED request", async () => {
		await insertStoredRequest("req-4", { itemKeys: [], status: "CANCELLED" });

		const result = await createRequest(createInput({ requestId: "req-4" }));

		expect(result.created).toBe(false);
		expect(totalSendCalls()).toBe(0);
		expect(await pipelineItems().countDocuments({ requestId: "req-4" })).toBe(0);
	});

	it("rejects a requestId that belongs to another asset", async () => {
		await createRequest(createInput());
		await expect(createRequest(createInput({ asset: { ...asset, _id: "asset-2" } }))).rejects.toBeInstanceOf(
			RequestIdConflictError
		);
	});

	it("rejects a requestId that is repeated with a different mode", async () => {
		await createRequest(createInput());
		await expect(createRequest(createInput({ mode: "postProcess" }))).rejects.toBeInstanceOf(RequestIdConflictError);
	});

	it("creates a separate request when the same requestId is used by another account", async () => {
		const first = await createRequest(createInput());
		const otherAsset = { ...asset, _id: "asset-2", accountId: "account-2" };
		await mediaAssets().insertOne(otherAsset);
		const other = await createRequest(createInput({ asset: otherAsset }));

		expect(other.created).toBe(true);
		expect(other.request._id).not.toBe(first.request._id);
		expect(await requests().countDocuments({ clientRequestId: "req-1" })).toBe(2);
	});

	it("bumps the asset version and uses the passed preset when re-encoding", async () => {
		await createRequest(createInput({ mode: "reencode", preset: { ...genericPreset, version: 2 } }));

		expect(await mediaAssets().findOne({ _id: "asset-1" })).toMatchObject({
			version: 2,
			presetName: "generic",
			presetVersion: 2,
			presetSnapshot: { version: 2 }
		});
	});

	it("creates exactly one set of items for concurrent calls with the same requestId", async () => {
		const [first, second] = await Promise.all([
			createRequest(createInput({ requestId: "req-race" })),
			createRequest(createInput({ requestId: "req-race" }))
		]);

		expect(first.request._id).toBe(second.request._id);
		expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
		expect(await requests().countDocuments({ clientRequestId: "req-race" })).toBe(1);
		expect(await pipelineItems().countDocuments({ requestId: first.request._id })).toBe(6);
	});

	it("resolves to the concurrent winner when the request insert hits a duplicate key", async () => {
		let winner: PipelineRequest | undefined;
		const spy = jest.spyOn(Collection.prototype, "findOneAndUpdate").mockImplementationOnce(async () => {
			winner = (await createRequest(createInput({ requestId: "req-dup" }))).request;
			throw new MongoServerError({ message: "E11000 duplicate key error", code: 11000 });
		});
		try {
			const result = await createRequest(createInput({ requestId: "req-dup" }));

			expect(winner).toBeDefined();
			expect(result).toMatchObject({ created: false, request: { _id: winner?._id } });
		} finally {
			spy.mockRestore();
		}
		expect(await requests().countDocuments({ clientRequestId: "req-dup" })).toBe(1);
		expect(await pipelineItems().countDocuments({ requestId: winner?._id })).toBe(6);
	});
});
