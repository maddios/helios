import { ensureIndexes, jobReports, mediaAssets, pipelineItems } from "../src/models";
import { createRequest, launchRequest } from "../src/pipeline";
import { genericPreset } from "../src/presets";
import { resetConfigForTests } from "../src/config";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";
import {
	asset,
	createInput,
	expectSentKeys,
	imageSource,
	insertStoredRequest,
	itemsOf,
	sentCallbacks,
	sentMessages,
	SENT_QUEUES,
	totalSendCalls,
	videoSource
} from "./helpers/pipelineFixtures";

jest.mock("../src/queue", () => require("./helpers/queueMock"));

describe("launchRequest", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await mediaAssets().insertOne(asset);
	});

	it("creates deterministic item ids with pending dependencies", async () => {
		const { request } = await createRequest(createInput());
		const items = await itemsOf(request);

		expect(Object.keys(items).sort()).toEqual(
			["mp4_360", "audio", "mp4_720", "mp4_1080", "transcribe", "scenes"].map((key) => `${request._id}:${key}`).sort()
		);
		expect(items[`${request._id}:scenes`]).toMatchObject({
			status: "BLOCKED",
			pendingDeps: [`${request._id}:mp4_360`, `${request._id}:transcribe`]
		});
		expect(items[`${request._id}:mp4_360`].dependents).toContain(`${request._id}:scenes`);
		expect(items[`${request._id}:transcribe`].dependents).toContain(`${request._id}:scenes`);
	});

	it("sends only QUEUED items to their queues", async () => {
		const { request } = await createRequest(createInput());
		expectSentKeys(request._id, {
			"lambda-p1": ["mp4_360"],
			"fargate-p2": ["audio", "mp4_720", "mp4_1080"],
			"lambda-ai": ["transcribe"]
		});
	});

	it("sets the message group and attributes on every message when fair queues are on", async () => {
		const { request } = await createRequest(createInput());
		const messages = SENT_QUEUES.flatMap(sentMessages);
		expect(messages).toHaveLength(5);
		for (const message of messages) {
			expect(message.groupId).toBe("account-1");
			expect(message.attributes).toMatchObject({
				accountId: "account-1",
				requestId: request._id,
				assetId: "asset-1",
				itemId: message.body.itemId
			});
		}
	});

	it("omits the message group when fair queues are off", async () => {
		process.env.SQS_FAIR_QUEUES = "false";
		resetConfigForTests();
		try {
			await createRequest(createInput());
			const messages = SENT_QUEUES.flatMap(sentMessages);
			expect(messages).toHaveLength(5);
			expect(messages.every((message) => message.groupId === undefined)).toBe(true);
		} finally {
			process.env.SQS_FAIR_QUEUES = "true";
			resetConfigForTests();
		}
	});

	it("resumes a request stored before a crash and enqueues its items", async () => {
		await insertStoredRequest("req-2", { itemKeys: ["mp4_360", "transcribe"] });

		const request = await launchRequest("req-2");

		expect(request.enqueuedAt).toBeInstanceOf(Date);
		expect(await pipelineItems().countDocuments({ requestId: "req-2" })).toBe(6);
		expectSentKeys("req-2", {
			"lambda-p1": ["mp4_360"],
			"fargate-p2": ["audio", "mp4_720", "mp4_1080"],
			"lambda-ai": ["transcribe"]
		});
	});

	it("bumps the asset version exactly once when a re-encode resumes after a crash", async () => {
		await insertStoredRequest("req-5", { mode: "reencode", assetVersion: 2 });

		await launchRequest("req-5");

		expect(await mediaAssets().findOne({ _id: "asset-1" })).toMatchObject({ version: 2, presetVersion: 1 });
	});

	it("skips items already COMPLETE in the database when resuming", async () => {
		await insertStoredRequest("req-3");
		await pipelineItems().updateOne({ _id: "req-3:mp4_360" }, { $set: { status: "COMPLETE" } });

		await launchRequest("req-3");

		expectSentKeys("req-3", {
			"fargate-p2": ["audio", "mp4_720", "mp4_1080"],
			"lambda-ai": ["transcribe"]
		});
		expect(await pipelineItems().findOne({ _id: "req-3:mp4_360" })).toMatchObject({ status: "COMPLETE" });
	});

	it("fails a non-purge request on a tombstoned asset with asset_deleted and writes nothing", async () => {
		await insertStoredRequest("req-deleted", { itemKeys: [] });
		await mediaAssets().updateOne({ _id: "asset-1" }, { $set: { deletedAt: new Date() } });

		const request = await launchRequest("req-deleted");

		expect(request).toMatchObject({ status: "ERROR", error: { code: "asset_deleted" } });
		expect(totalSendCalls()).toBe(0);
		expect(await pipelineItems().countDocuments({ requestId: "req-deleted" })).toBe(0);
	});

	it("does not launch a CANCELLED request", async () => {
		await insertStoredRequest("req-4", { itemKeys: [], status: "CANCELLED" });

		const request = await launchRequest("req-4");

		expect(request.status).toBe("CANCELLED");
		expect(totalSendCalls()).toBe(0);
		expect(await pipelineItems().countDocuments({ requestId: "req-4" })).toBe(0);
	});

	it("skips transcribe and does not send SKIPPED items for a silent video", async () => {
		const silent = { ...asset, _id: "asset-silent", sourceMetadata: { ...videoSource, hasAudio: false } };
		await mediaAssets().insertOne(silent);

		const { request } = await createRequest(createInput({ asset: silent }));
		const items = await itemsOf(request);

		expect(request.pendingItems).not.toContain(`${request._id}:transcribe`);
		expect(request.pendingItems).toHaveLength(4);
		expect(items[`${request._id}:transcribe`]).toMatchObject({ status: "SKIPPED" });
		expect(items[`${request._id}:transcribe`].completedAt).toBeInstanceOf(Date);
		expectSentKeys(request._id, { "lambda-p1": ["mp4_360"], "fargate-p2": ["mp4_720", "mp4_1080"] });
	});

	it("queues scenes without dependencies and skips transcribe for a silent video in postProcess mode", async () => {
		const silent = { ...asset, _id: "asset-silent", sourceMetadata: { ...videoSource, hasAudio: false } };
		await mediaAssets().insertOne(silent);

		const { request } = await createRequest(createInput({ asset: silent, mode: "postProcess" }));
		const items = await itemsOf(request);

		expect(items[`${request._id}:scenes`]).toMatchObject({ status: "QUEUED", pendingDeps: [] });
		expect(items[`${request._id}:transcribe`]).toMatchObject({ status: "SKIPPED" });
		expect(request.pendingItems).toEqual([`${request._id}:scenes`]);
		expectSentKeys(request._id, { "lambda-ai": ["scenes"] });
	});

	it("plans the image item and scenes, with scenes waiting on the image item only", async () => {
		const image = { ...asset, _id: "asset-image", sourceMetadata: imageSource };
		await mediaAssets().insertOne(image);

		const { request } = await createRequest(createInput({ asset: image }));
		const items = await itemsOf(request);

		expect(Object.keys(items).sort()).toEqual([`${request._id}:image`, `${request._id}:scenes`].sort());
		expect(items[`${request._id}:scenes`]).toMatchObject({ status: "BLOCKED", pendingDeps: [`${request._id}:image`] });
		expectSentKeys(request._id, { "lambda-p1": ["image"] });
	});

	it("leaves the asset unchanged in postProcess mode", async () => {
		await createRequest(createInput({ mode: "postProcess", preset: { ...genericPreset, version: 2 } }));

		expect(await mediaAssets().findOne({ _id: "asset-1" })).toMatchObject({ version: 1, presetVersion: 1 });
	});

	it("fails a request with nothing to do as ERROR without items, enqueues or item writes", async () => {
		const { request } = await createRequest(
			createInput({
				requestId: "req-empty",
				mode: "postProcess",
				postProcess: { transcribe: false, sceneDetection: false }
			})
		);

		expect(request).toMatchObject({
			status: "ERROR",
			error: { code: "nothing_to_do", message: "Request has no work to do" },
			pendingItems: []
		});
		expect(await pipelineItems().countDocuments({})).toBe(0);
		expect(totalSendCalls()).toBe(0);
		expect(await jobReports().findOne({ _id: request._id })).toMatchObject({ status: "ERROR", items: [] });
		expect(sentCallbacks()).toEqual([{ type: "request", requestId: request._id }]);
	});

	it("throws when the request's asset is missing", async () => {
		await insertStoredRequest("req-6");
		await mediaAssets().deleteMany({});

		await expect(launchRequest("req-6")).rejects.toThrow("not found");
	});
});
