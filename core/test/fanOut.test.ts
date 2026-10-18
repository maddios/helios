import { Collection, MongoServerError } from "mongodb";
import {
	QueueNameSchema,
	type ImageSourceMetadata,
	type QueueName,
	type RequestMode,
	type ResolvedPostProcess,
	type VideoSourceMetadata
} from "@helios/contracts";
import {
	ensureIndexes,
	mediaAssets,
	pipelineItems,
	requests,
	type MediaAsset,
	type PipelineItem,
	type PipelineRequest
} from "../src/models";
import { genericPreset } from "../src/presets";
import {
	fanOut,
	NothingToDoError,
	planItems,
	RequestIdConflictError,
	type FanOutInput,
	type ItemMessage,
	type PlannedItem
} from "../src/pipeline";
import { queueFor } from "../src/queue";
import { resetConfigForTests } from "../src/config";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

jest.mock("../src/queue", () => {
	const senders = new Map<string, { sendBatch: jest.Mock }>();
	return {
		queueFor: (name: string) => {
			let sender = senders.get(name);
			if (sender === undefined) {
				sender = { sendBatch: jest.fn() };
				senders.set(name, sender);
			}
			return sender;
		}
	};
});

const SENT_QUEUES: QueueName[] = ["lambda-p1", "fargate-p2", "lambda-ai"];
const thresholds = { maxDurationSec: 180, maxSourceBytes: 524288000 };
const allPostProcess: ResolvedPostProcess = { transcribe: { translateToEnglish: true }, sceneDetection: true };

const videoSource: VideoSourceMetadata = {
	type: "video",
	sizeBytes: 1000000,
	width: 1920,
	height: 1080,
	durationSec: 60,
	fps: 30,
	videoCodec: "h264",
	hasAudio: true
};

const imageSource: ImageSourceMetadata = {
	type: "image",
	sizeBytes: 1000000,
	width: 1920,
	height: 1080,
	hasAudio: false
};

const asset: MediaAsset = {
	_id: "asset-1",
	accountId: "account-1",
	source: { bucket: "bucket", key: "source.mp4" },
	sourceMetadata: videoSource,
	presetName: "generic",
	presetVersion: 1,
	presetSnapshot: genericPreset,
	version: 1,
	outputs: {},
	createdAt: new Date(),
	updatedAt: new Date()
};

function input(overrides: Partial<FanOutInput> = {}): FanOutInput {
	return { requestId: "req-1", asset, mode: "encode", preset: genericPreset, ...overrides };
}

function sendBatchOf(queue: QueueName) {
	return jest.mocked(queueFor<ItemMessage>(queue).sendBatch);
}

function sentMessages(queue: QueueName) {
	return sendBatchOf(queue).mock.calls.flatMap(([messages]) => messages);
}

function totalSendCalls(): number {
	return QueueNameSchema.options.reduce((total, queue) => total + sendBatchOf(queue).mock.calls.length, 0);
}

function expectSentKeys(requestId: string, expected: Partial<Record<QueueName, string[]>>): void {
	for (const queue of QueueNameSchema.options) {
		expect(sentMessages(queue).map((message) => message.body)).toEqual(
			(expected[queue] ?? []).map((key) => ({ itemId: `${requestId}:${key}` }))
		);
	}
}

async function itemsOf(request: PipelineRequest): Promise<Record<string, PipelineItem>> {
	const items = await pipelineItems().find({ requestId: request._id }).toArray();
	return Object.fromEntries(items.map((item) => [item._id, item]));
}

function planFor(mode: RequestMode, source: VideoSourceMetadata | ImageSourceMetadata = videoSource): PlannedItem[] {
	return planItems({ preset: genericPreset, source, postProcess: allPostProcess, mode, thresholds });
}

function plannedItemDocs(requestId: string, plan: PlannedItem[]): PipelineItem[] {
	const itemId = (key: string) => `${requestId}:${key}`;
	return plan.map((item) => ({
		_id: itemId(item.key),
		requestId,
		assetId: "asset-1",
		accountId: "account-1",
		kind: item.kind,
		...(item.profile !== undefined && { profile: item.profile }),
		queue: item.queue,
		priority: item.priority,
		status: item.status,
		pendingDeps: item.dependsOn.map(itemId),
		dependents: plan.filter((other) => other.dependsOn.includes(item.key)).map((other) => itemId(other.key)),
		attempts: 0,
		progress: 0,
		createdAt: new Date()
	}));
}

async function insertStoredRequest(
	requestId: string,
	{
		mode = "encode",
		assetVersion = 1,
		status = "IN_PROGRESS",
		itemKeys
	}: {
		mode?: RequestMode;
		assetVersion?: number;
		status?: PipelineRequest["status"];
		itemKeys?: string[];
	} = {}
): Promise<void> {
	const plan = planFor(mode);
	const docs = plannedItemDocs(requestId, plan);
	await requests().insertOne({
		_id: requestId,
		clientRequestId: requestId,
		accountId: "account-1",
		assetId: "asset-1",
		mode,
		presetSnapshot: genericPreset,
		postProcess: allPostProcess,
		assetVersion,
		pendingItems: docs.filter((doc) => doc.status !== "SKIPPED").map((doc) => doc._id),
		status,
		createdAt: new Date()
	});
	const inserted =
		itemKeys === undefined ? docs : docs.filter((doc) => itemKeys.includes(doc._id.slice(requestId.length + 1)));
	if (inserted.length > 0) {
		await pipelineItems().insertMany(inserted);
	}
}

describe("fanOut", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await mediaAssets().insertOne(asset);
	});

	it("creates an in-progress request with pending item ids and enqueuedAt", async () => {
		const result = await fanOut(input());
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
		const { request } = await fanOut(input({ requestId: undefined }));
		expect(request.clientRequestId).toBe(request._id);
	});

	it("creates deterministic item ids with pending dependencies", async () => {
		const { request } = await fanOut(input());
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
		const { request } = await fanOut(input());
		expectSentKeys(request._id, {
			"lambda-p1": ["mp4_360"],
			"fargate-p2": ["audio", "mp4_720", "mp4_1080"],
			"lambda-ai": ["transcribe"]
		});
	});

	it("sets the message group and attributes on every message when fair queues are on", async () => {
		const { request } = await fanOut(input());
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
			await fanOut(input());
			const messages = SENT_QUEUES.flatMap(sentMessages);
			expect(messages).toHaveLength(5);
			expect(messages.every((message) => message.groupId === undefined)).toBe(true);
		} finally {
			process.env.SQS_FAIR_QUEUES = "true";
			resetConfigForTests();
		}
	});

	it("returns the existing request without writes when repeated", async () => {
		const first = await fanOut(input());
		const sendCalls = totalSendCalls();
		const itemCount = await pipelineItems().countDocuments({ requestId: first.request._id });

		const repeat = await fanOut(input());

		expect(repeat.created).toBe(false);
		expect(repeat.request._id).toBe(first.request._id);
		expect(await pipelineItems().countDocuments({ requestId: first.request._id })).toBe(itemCount);
		expect(totalSendCalls()).toBe(sendCalls);
	});

	it("rejects a requestId that belongs to another asset", async () => {
		await fanOut(input());
		await expect(fanOut(input({ asset: { ...asset, _id: "asset-2" } }))).rejects.toBeInstanceOf(RequestIdConflictError);
	});

	it("rejects a requestId that is repeated with a different mode", async () => {
		await fanOut(input());
		await expect(fanOut(input({ mode: "postProcess" }))).rejects.toBeInstanceOf(RequestIdConflictError);
	});

	it("creates a separate request when the same requestId is used by another account", async () => {
		const first = await fanOut(input());
		const otherAsset = { ...asset, _id: "asset-2", accountId: "account-2" };
		await mediaAssets().insertOne(otherAsset);
		const other = await fanOut(input({ asset: otherAsset }));

		expect(other.created).toBe(true);
		expect(other.request._id).not.toBe(first.request._id);
		expect(await requests().countDocuments({ clientRequestId: "req-1" })).toBe(2);
	});

	it("resumes a request stored before a crash and enqueues its items", async () => {
		await insertStoredRequest("req-2", { itemKeys: ["mp4_360", "transcribe"] });

		const result = await fanOut(input({ requestId: "req-2" }));

		expect(result.created).toBe(false);
		expect(result.request.enqueuedAt).toBeInstanceOf(Date);
		expect(await pipelineItems().countDocuments({ requestId: "req-2" })).toBe(6);
		expectSentKeys("req-2", {
			"lambda-p1": ["mp4_360"],
			"fargate-p2": ["audio", "mp4_720", "mp4_1080"],
			"lambda-ai": ["transcribe"]
		});
	});

	it("bumps the asset version exactly once when a re-encode resumes after a crash", async () => {
		await insertStoredRequest("req-5", { mode: "reencode", assetVersion: 2 });

		await fanOut(input({ requestId: "req-5", mode: "reencode" }));

		expect(await mediaAssets().findOne({ _id: "asset-1" })).toMatchObject({ version: 2, presetVersion: 1 });
	});

	it("skips items already COMPLETE in the database when resuming", async () => {
		await insertStoredRequest("req-3");
		await pipelineItems().updateOne({ _id: "req-3:mp4_360" }, { $set: { status: "COMPLETE" } });

		await fanOut(input({ requestId: "req-3" }));

		expectSentKeys("req-3", {
			"fargate-p2": ["audio", "mp4_720", "mp4_1080"],
			"lambda-ai": ["transcribe"]
		});
		expect(await pipelineItems().findOne({ _id: "req-3:mp4_360" })).toMatchObject({ status: "COMPLETE" });
	});

	it("does not enqueue a CANCELLED request", async () => {
		await insertStoredRequest("req-4", { itemKeys: [], status: "CANCELLED" });

		const result = await fanOut(input({ requestId: "req-4" }));

		expect(result.created).toBe(false);
		expect(totalSendCalls()).toBe(0);
		expect(await pipelineItems().countDocuments({ requestId: "req-4" })).toBe(0);
	});

	it("creates exactly one set of items for concurrent calls with the same requestId", async () => {
		const [first, second] = await Promise.all([
			fanOut(input({ requestId: "req-race" })),
			fanOut(input({ requestId: "req-race" }))
		]);

		expect(first.request._id).toBe(second.request._id);
		expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
		expect(await requests().countDocuments({ clientRequestId: "req-race" })).toBe(1);
		expect(await pipelineItems().countDocuments({ requestId: first.request._id })).toBe(6);
	});

	it("resolves to the concurrent winner when the request insert hits a duplicate key", async () => {
		let winner: PipelineRequest | undefined;
		const spy = jest.spyOn(Collection.prototype, "findOneAndUpdate").mockImplementationOnce(async () => {
			winner = (await fanOut(input({ requestId: "req-dup" }))).request;
			throw new MongoServerError({ message: "E11000 duplicate key error", code: 11000 });
		});
		try {
			const result = await fanOut(input({ requestId: "req-dup" }));

			expect(winner).toBeDefined();
			expect(result).toMatchObject({ created: false, request: { _id: winner?._id } });
		} finally {
			spy.mockRestore();
		}
		expect(await requests().countDocuments({ clientRequestId: "req-dup" })).toBe(1);
		expect(await pipelineItems().countDocuments({ requestId: winner?._id })).toBe(6);
	});

	it("skips transcribe and does not send SKIPPED items for a silent video", async () => {
		const silent = { ...asset, sourceMetadata: { ...videoSource, hasAudio: false } };
		const { request } = await fanOut(input({ asset: silent }));
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

		const { request } = await fanOut(input({ asset: silent, mode: "postProcess" }));
		const items = await itemsOf(request);

		expect(items[`${request._id}:scenes`]).toMatchObject({ status: "QUEUED", pendingDeps: [] });
		expect(items[`${request._id}:transcribe`]).toMatchObject({ status: "SKIPPED" });
		expect(request.pendingItems).toEqual([`${request._id}:scenes`]);
		expectSentKeys(request._id, { "lambda-ai": ["scenes"] });
	});

	it("plans the image item and scenes, with scenes waiting on the image item only", async () => {
		const image = { ...asset, _id: "asset-image", sourceMetadata: imageSource };
		await mediaAssets().insertOne(image);

		const { request } = await fanOut(input({ asset: image }));
		const items = await itemsOf(request);

		expect(Object.keys(items).sort()).toEqual([`${request._id}:image`, `${request._id}:scenes`].sort());
		expect(items[`${request._id}:scenes`]).toMatchObject({ status: "BLOCKED", pendingDeps: [`${request._id}:image`] });
		expectSentKeys(request._id, { "lambda-p1": ["image"] });
	});

	it("leaves the asset unchanged in postProcess mode", async () => {
		await fanOut(input({ mode: "postProcess", preset: { ...genericPreset, version: 2 } }));

		expect(await mediaAssets().findOne({ _id: "asset-1" })).toMatchObject({ version: 1, presetVersion: 1 });
	});

	it("bumps the asset version and uses the passed preset when re-encoding", async () => {
		await fanOut(input({ mode: "reencode", preset: { ...genericPreset, version: 2 } }));

		expect(await mediaAssets().findOne({ _id: "asset-1" })).toMatchObject({
			version: 2,
			presetName: "generic",
			presetVersion: 2,
			presetSnapshot: { version: 2 }
		});
	});

	it("throws NothingToDoError before any write when there is no work", async () => {
		const empty = input({
			requestId: "req-empty",
			mode: "postProcess",
			postProcess: { transcribe: false, sceneDetection: false }
		});

		await expect(fanOut(empty)).rejects.toBeInstanceOf(NothingToDoError);
		expect(await requests().countDocuments({})).toBe(0);
		expect(await pipelineItems().countDocuments({})).toBe(0);
		expect(totalSendCalls()).toBe(0);
	});
});
