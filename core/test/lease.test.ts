import type { Usage } from "@helios/contracts";
import { ensureIndexes, mediaAssets, pipelineItems, type MediaAsset } from "../src/models";
import { claimItem, fanOut, recordFailedAttempt, releaseLease, renewLease } from "../src/pipeline";
import { genericPreset } from "../src/presets";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

jest.mock("../src/queue", () => require("./helpers/queueMock"));

const LEASE_SEC = 90;
const usage: Usage = { computeTier: "lambda", computeSec: 3, memoryMb: 1024 };

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

let ITEM: string;

describe("lease operations", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await mediaAssets().insertOne(asset);
		const { request } = await fanOut({ asset, mode: "encode", preset: genericPreset });
		ITEM = `${request._id}:mp4_360`;
	});

	it("renews the heartbeat and progress only for the current lease", async () => {
		const claim = await claimItem(ITEM, "msg-1", LEASE_SEC);
		if (!claim.claimed) {
			throw new Error("expected a claim");
		}

		expect(await renewLease(ITEM, "stale-lease", 40)).toBe(false);
		expect(await renewLease(ITEM, claim.leaseId, 40)).toBe(true);
		expect(await pipelineItems().findOne({ _id: ITEM })).toMatchObject({ progress: 40 });
	});

	it("reports a lost lease after another worker reclaimed the item", async () => {
		const first = await claimItem(ITEM, "msg-1", LEASE_SEC);
		await pipelineItems().updateOne({ _id: ITEM }, { $set: { heartbeatAt: new Date(0) } });
		const second = await claimItem(ITEM, "msg-2", LEASE_SEC);
		if (!first.claimed || !second.claimed) {
			throw new Error("expected both claims to succeed");
		}

		expect(await renewLease(ITEM, first.leaseId)).toBe(false);
		expect(await renewLease(ITEM, second.leaseId)).toBe(true);
	});

	it("releases the lease back to QUEUED without consuming an attempt", async () => {
		const claim = await claimItem(ITEM, "msg-1", LEASE_SEC);
		if (!claim.claimed) {
			throw new Error("expected a claim");
		}

		await releaseLease(ITEM, "stale-lease");
		expect(await pipelineItems().findOne({ _id: ITEM })).toMatchObject({ status: "IN_PROGRESS" });

		await releaseLease(ITEM, claim.leaseId);

		const item = await pipelineItems().findOne({ _id: ITEM });
		expect(item).toMatchObject({ status: "QUEUED", attempts: 0 });
		expect(item).not.toHaveProperty("leaseId");
		expect(item).not.toHaveProperty("heartbeatAt");
	});

	it("records the interrupted attempt usage only under the current lease and still releases without consuming an attempt", async () => {
		const claim = await claimItem(ITEM, "msg-1", LEASE_SEC);
		if (!claim.claimed) {
			throw new Error("expected a claim");
		}

		await releaseLease(ITEM, "stale-lease", usage);
		expect(await pipelineItems().findOne({ _id: ITEM })).toMatchObject({ status: "IN_PROGRESS", usage: [] });

		await releaseLease(ITEM, claim.leaseId, usage);
		expect(await pipelineItems().findOne({ _id: ITEM })).toMatchObject({
			status: "QUEUED",
			attempts: 0,
			usage: [usage]
		});
	});

	it("ignores a failed attempt written without the current lease", async () => {
		const claim = await claimItem(ITEM, "msg-1", LEASE_SEC);
		if (!claim.claimed) {
			throw new Error("expected a claim");
		}

		await recordFailedAttempt({ itemId: ITEM, leaseId: "stale-lease", usage, error: "late" });
		expect(await pipelineItems().findOne({ _id: ITEM })).toMatchObject({ usage: [], status: "IN_PROGRESS" });
		expect(await pipelineItems().findOne({ _id: ITEM })).not.toHaveProperty("error");

		await recordFailedAttempt({ itemId: ITEM, leaseId: claim.leaseId, usage, error: "boom" });
		expect(await pipelineItems().findOne({ _id: ITEM })).toMatchObject({ usage: [usage], error: "boom" });
	});
});
