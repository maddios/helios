import { ensureIndexes, mediaAssets, pipelineItems, requests, type MediaAsset } from "../src/models";
import { claimItem, fanOut, type FanOutInput } from "../src/pipeline";
import { genericPreset } from "../src/presets";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

jest.mock("../src/queue", () => require("./helpers/queueMock"));

const asset: MediaAsset = {
	_id: "asset-1",
	accountId: "account-1",
	source: { bucket: "bucket", key: "source.mp4" },
	sourceMetadata: {
		type: "video",
		sizeBytes: 1000000,
		width: 1920,
		height: 1080,
		durationSec: 60,
		fps: 30,
		videoCodec: "h264",
		hasAudio: true
	},
	presetName: "generic",
	presetVersion: 1,
	presetSnapshot: genericPreset,
	version: 1,
	outputs: {},
	createdAt: new Date(),
	updatedAt: new Date()
};

const LEASE_SEC = 90;

let requestId: string;

function itemId(key: string): string {
	return `${requestId}:${key}`;
}

function input(overrides: Partial<FanOutInput> = {}): FanOutInput {
	return { requestId: "req-claim", asset, mode: "encode", preset: genericPreset, ...overrides };
}

async function setItem(id: string, fields: Record<string, unknown>): Promise<void> {
	await pipelineItems().updateOne({ _id: id }, { $set: fields });
}

describe("claimItem", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await mediaAssets().insertOne(asset);
		requestId = (await fanOut(input())).request._id;
	});

	it("claims a QUEUED item and records the message, start time and attempt", async () => {
		const result = await claimItem(itemId("mp4_360"), "msg-1", LEASE_SEC);

		expect(result).toMatchObject({
			claimed: true,
			item: { _id: itemId("mp4_360"), status: "IN_PROGRESS", messageId: "msg-1", attempts: 1 },
			request: { clientRequestId: "req-claim" }
		});
		expect(result.claimed && result.item.startedAt).toBeInstanceOf(Date);
	});

	it("reports busy with the holder's messageId when the same message is redelivered", async () => {
		await claimItem(itemId("mp4_360"), "msg-1", LEASE_SEC);

		expect(await claimItem(itemId("mp4_360"), "msg-1", LEASE_SEC)).toEqual({
			claimed: false,
			reason: "busy",
			messageId: "msg-1"
		});
		expect(await pipelineItems().findOne({ _id: itemId("mp4_360") })).toMatchObject({ attempts: 1 });
	});

	it("reports busy with the holder's messageId when a different message arrives during a fresh lease", async () => {
		await claimItem(itemId("mp4_360"), "msg-1", LEASE_SEC);

		expect(await claimItem(itemId("mp4_360"), "msg-2", LEASE_SEC)).toEqual({
			claimed: false,
			reason: "busy",
			messageId: "msg-1"
		});
	});

	it("reclaims an IN_PROGRESS item whose heartbeat is older than the lease with a new leaseId", async () => {
		const first = await claimItem(itemId("mp4_360"), "msg-1", LEASE_SEC);
		await setItem(itemId("mp4_360"), { heartbeatAt: new Date(Date.now() - (LEASE_SEC + 1) * 1000) });

		const second = await claimItem(itemId("mp4_360"), "msg-2", LEASE_SEC);

		if (!first.claimed || !second.claimed) {
			throw new Error("expected both claims to succeed");
		}
		expect(second.leaseId).not.toBe(first.leaseId);
		expect(second.item).toMatchObject({ messageId: "msg-2", attempts: 2 });
	});

	it("claims a BLOCKED item whose dependencies are all done", async () => {
		await setItem(itemId("scenes"), { pendingDeps: [] });

		const result = await claimItem(itemId("scenes"), "msg-scenes", LEASE_SEC);

		expect(result).toMatchObject({ claimed: true, item: { status: "IN_PROGRESS" } });
	});

	it("does not claim a BLOCKED item with pending dependencies", async () => {
		expect(await claimItem(itemId("scenes"), "msg-scenes", LEASE_SEC)).toEqual({
			claimed: false,
			reason: "not-claimable"
		});
		expect(await pipelineItems().findOne({ _id: itemId("scenes") })).toMatchObject({ status: "BLOCKED", attempts: 0 });
	});

	it("reports a terminal item so the caller can rerun its handoff", async () => {
		await setItem(itemId("mp4_360"), { status: "COMPLETE" });

		expect(await claimItem(itemId("mp4_360"), "msg-1", LEASE_SEC)).toMatchObject({
			claimed: false,
			reason: "terminal",
			status: "COMPLETE"
		});
	});

	it("lets exactly one of two concurrent deliveries with different messageIds claim the item", async () => {
		const results = await Promise.all([
			claimItem(itemId("mp4_360"), "msg-a", LEASE_SEC),
			claimItem(itemId("mp4_360"), "msg-b", LEASE_SEC)
		]);

		expect(results.filter((result) => result.claimed)).toHaveLength(1);
		expect(await pipelineItems().findOne({ _id: itemId("mp4_360") })).toMatchObject({ attempts: 1 });
	});

	it("does not claim an unknown item", async () => {
		expect(await claimItem("missing", "msg-1", LEASE_SEC)).toEqual({ claimed: false, reason: "not-claimable" });
	});

	it("marks the item CANCELLED when its request was cancelled", async () => {
		await requests().updateOne({ _id: requestId }, { $set: { status: "CANCELLED" } });

		expect(await claimItem(itemId("mp4_360"), "msg-1", LEASE_SEC)).toEqual({ claimed: false, reason: "cancelled" });
		expect(await pipelineItems().findOne({ _id: itemId("mp4_360") })).toMatchObject({
			status: "CANCELLED",
			completedAt: expect.any(Date)
		});
	});
});
