import type { MediaAssetOutput, Usage, VideoSourceMetadata } from "@helios/contracts";
import {
	ensureIndexes,
	jobReports,
	mediaAssets,
	pipelineItems,
	requests,
	usageDaily,
	type MediaAsset
} from "../src/models";
import {
	claimItem,
	completeItem,
	dayKey,
	createRequest,
	type CallbackMessage,
	type ItemMessage
} from "../src/pipeline";
import { queueFor } from "../src/queue";
import { genericPreset } from "../src/presets";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

jest.mock("../src/queue", () => require("./helpers/queueMock"));

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

const asset: MediaAsset = {
	_id: "asset-1",
	accountId: "account-1",
	source: { type: "s3", bucket: "bucket", key: "source.mp4" },
	sourceMetadata: videoSource,
	presetName: "generic",
	presetVersion: 1,
	presetSnapshot: genericPreset,
	version: 1,
	outputs: {},
	createdAt: new Date(),
	updatedAt: new Date()
};

const LEASE_SEC = 90;
const ENCODE_KEYS = ["mp4_360", "audio", "mp4_720", "mp4_1080"];
const lambdaUsage: Usage = { computeTier: "lambda", computeSec: 2, memoryMb: 1024 };

let requestId: string;

function itemId(key: string): string {
	return `${requestId}:${key}`;
}

function sentTo(queue: string) {
	return jest.mocked(queueFor<ItemMessage>(queue as never).send).mock.calls.map(([message]) => message);
}

function sentCallbacks() {
	return jest.mocked(queueFor<CallbackMessage>("callbacks.fifo").send).mock.calls.map(([message]) => message);
}

async function statusOf(key: string) {
	return (await pipelineItems().findOne({ _id: itemId(key) }))?.status;
}

async function claimAndComplete(key: string, usage: Usage = lambdaUsage) {
	const claim = await claimItem(itemId(key), `msg-${key}`, LEASE_SEC);
	expect(claim.claimed).toBe(true);
	await completeItem({ itemId: itemId(key), status: "COMPLETE", usage });
}

async function claimAndFail(key: string, error: string) {
	await claimItem(itemId(key), `msg-${key}`, LEASE_SEC);
	await completeItem({ itemId: itemId(key), status: "ERROR", error });
}

async function completeAll(): Promise<void> {
	for (const key of [...ENCODE_KEYS, "transcribe", "scenes"]) {
		await claimAndComplete(key);
	}
}

const outputFor = (key: string): MediaAssetOutput => ({
	profileName: key,
	profileVersion: 1,
	kind: "video",
	key: `acme/media/asset-1/${key}.mp4`,
	gated: false
});

describe("completeItem", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await mediaAssets().insertOne(asset);
		requestId = (await createRequest({ asset, mode: "encode", preset: genericPreset, analyze: "sync" })).request._id;
		jest.clearAllMocks();
	});

	it("releases scenes only after both of its dependencies complete", async () => {
		await claimAndComplete("mp4_360");

		expect(await pipelineItems().findOne({ _id: itemId("scenes") })).toMatchObject({
			status: "BLOCKED",
			pendingDeps: [itemId("transcribe")]
		});
		expect(sentTo("lambda-p1")).toEqual([]);

		await claimAndComplete("transcribe");

		expect(await statusOf("scenes")).toBe("QUEUED");
		expect(sentTo("lambda-ai")).toEqual([expect.objectContaining({ body: { itemId: itemId("scenes") } })]);
	});

	it("sends a released dependent with its group and correlation attributes", async () => {
		await claimAndComplete("mp4_360");
		await claimAndComplete("transcribe");

		expect(jest.mocked(queueFor<ItemMessage>("lambda-ai" as never).send).mock.calls[0][0]).toMatchObject({
			groupId: "account-1",
			attributes: { accountId: "account-1", requestId, itemId: itemId("scenes"), assetId: "asset-1" }
		});
	});

	it("sends the item callback for every completion", async () => {
		await claimAndComplete("mp4_360");

		expect(sentCallbacks()).toEqual([
			{
				body: { type: "item", requestId, itemId: itemId("mp4_360") },
				groupId: requestId,
				deduplicationId: `${itemId("mp4_360")}:item`
			}
		]);
	});

	it("re-sends a dependent after a crash between send and flip, then stops once it is QUEUED", async () => {
		await claimAndComplete("mp4_360");
		await claimAndComplete("transcribe");
		await pipelineItems().updateOne({ _id: itemId("scenes") }, { $set: { status: "BLOCKED" } });

		await completeItem({ itemId: itemId("transcribe"), status: "COMPLETE" });

		expect(await statusOf("scenes")).toBe("QUEUED");
		expect(sentTo("lambda-ai")).toHaveLength(2);

		await completeItem({ itemId: itemId("transcribe"), status: "COMPLETE" });

		expect(sentTo("lambda-ai")).toHaveLength(2);
		expect(await statusOf("scenes")).toBe("QUEUED");
	});

	it("finalizes a request exactly once with one job report, one final callback and the resource units", async () => {
		await completeAll();

		expect(await requests().findOne({ _id: requestId })).toMatchObject({
			status: "COMPLETE",
			pendingItems: [],
			completedAt: expect.any(Date)
		});
		expect(await jobReports().countDocuments({ requestId })).toBe(1);
		expect(await jobReports().findOne({ requestId })).toMatchObject({
			status: "COMPLETE",
			usage: { byTier: { lambda: { attempts: 6, computeSec: 12 } } },
			resourceUnits: { lambdaGbSeconds: 12, fargateVcpuSeconds: 0, fargateSpotVcpuSeconds: 0, llmTokens: {} },
			items: expect.arrayContaining([expect.objectContaining({ itemId: itemId("scenes"), status: "COMPLETE" })])
		});
		expect(sentCallbacks().filter((message) => message.body.type === "request")).toEqual([
			{ body: { type: "request", requestId }, groupId: requestId, deduplicationId: `${requestId}:final` }
		]);
	});

	it("repairs a finalize that crashed before flipping the request, without a second job report or usage increment", async () => {
		await completeAll();
		await requests().updateOne({ _id: requestId }, { $set: { status: "IN_PROGRESS" } });

		await completeItem({ itemId: itemId("scenes"), status: "COMPLETE" });

		expect(await jobReports().countDocuments({ requestId })).toBe(1);
		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
		expect(await usageDaily().findOne({ accountId: "account-1" })).toMatchObject({
			requests: 1,
			units: { lambdaGbSeconds: 12 }
		});
	});

	it("finalizes as ERROR when any item errors, skipping only the scenes item that requires the failed one", async () => {
		await claimAndFail("mp4_360", "boom");
		expect(await pipelineItems().findOne({ _id: itemId("scenes") })).toMatchObject({
			status: "SKIPPED",
			error: `dependency ${itemId("mp4_360")} ERROR`
		});
		for (const key of ["audio", "mp4_720", "mp4_1080", "transcribe"]) {
			await claimAndComplete(key);
		}

		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "ERROR" });
		expect(await jobReports().findOne({ requestId })).toMatchObject({
			status: "ERROR",
			items: expect.arrayContaining([expect.objectContaining({ itemId: itemId("mp4_360"), error: "boom" })])
		});
	});

	it("cascades a required ERROR to scenes and finalizes the request as ERROR", async () => {
		await claimAndFail("mp4_360", "boom");
		await claimAndComplete("audio");
		await claimAndComplete("mp4_720");
		await claimAndComplete("mp4_1080");
		await claimAndComplete("transcribe");

		expect(await statusOf("scenes")).toBe("SKIPPED");
		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "ERROR", pendingItems: [] });
	});

	it("releases scenes when the optional transcribe item errors", async () => {
		await claimAndFail("transcribe", "asr failed");

		expect(await statusOf("scenes")).toBe("BLOCKED");
		await claimAndComplete("mp4_360");

		expect(await statusOf("scenes")).toBe("QUEUED");
		expect(sentTo("lambda-ai")).toEqual([expect.objectContaining({ body: { itemId: itemId("scenes") } })]);
	});

	it("keeps an optional SKIPPED dependency blocked until the required one completes", async () => {
		await completeItem({ itemId: itemId("transcribe"), status: "SKIPPED" });

		expect(await statusOf("scenes")).toBe("BLOCKED");

		await completeItem({ itemId: itemId("mp4_360"), status: "SKIPPED" });

		expect(await statusOf("transcribe")).toBe("SKIPPED");
		expect(await pipelineItems().findOne({ _id: itemId("scenes") })).toMatchObject({
			status: "SKIPPED",
			error: `dependency ${itemId("mp4_360")} SKIPPED`
		});
	});

	it("keeps the first terminal result when an item is completed again", async () => {
		const output = { activeStill: { index: 0, timestampSec: 0, selectedByUser: false } };
		await claimItem(itemId("mp4_360"), "msg-1", LEASE_SEC);
		await completeItem({ itemId: itemId("mp4_360"), status: "COMPLETE", output });
		await completeItem({ itemId: itemId("mp4_360"), status: "ERROR", error: "late" });

		const item = await pipelineItems().findOne({ _id: itemId("mp4_360") });
		expect(item).toMatchObject({ status: "COMPLETE", output });
		expect(item).not.toHaveProperty("error");
	});

	it("ignores a late COMPLETE after ERROR: no asset outputs and no status change", async () => {
		await claimItem(itemId("mp4_720"), "msg-1", LEASE_SEC);
		await completeItem({ itemId: itemId("mp4_720"), status: "ERROR", error: "boom" });

		await completeItem({
			itemId: itemId("mp4_720"),
			status: "COMPLETE",
			output: { assetOutputs: { mp4_720: outputFor("mp4_720") } }
		});

		expect(await pipelineItems().findOne({ _id: itemId("mp4_720") })).toMatchObject({ status: "ERROR", error: "boom" });
		expect(await mediaAssets().findOne({ _id: "asset-1" })).toMatchObject({ outputs: {} });
	});

	it("clears the error of a retried attempt when it completes", async () => {
		await claimItem(itemId("mp4_720"), "msg-1", LEASE_SEC);
		await pipelineItems().updateOne({ _id: itemId("mp4_720") }, { $set: { error: "first attempt failed" } });

		await completeItem({ itemId: itemId("mp4_720"), status: "COMPLETE" });

		const item = await pipelineItems().findOne({ _id: itemId("mp4_720") });
		expect(item?.status).toBe("COMPLETE");
		expect(item).not.toHaveProperty("error");
	});

	it("writes asset outputs and the active still from the stored output", async () => {
		await completeItem({
			itemId: itemId("mp4_720"),
			status: "COMPLETE",
			output: {
				assetOutputs: { mp4_720: outputFor("mp4_720") },
				activeStill: { index: 0, timestampSec: 0, selectedByUser: false }
			}
		});

		expect(await mediaAssets().findOne({ _id: "asset-1" })).toMatchObject({
			outputs: { mp4_720: outputFor("mp4_720") },
			activeStill: { index: 0, timestampSec: 0, selectedByUser: false }
		});
	});

	it("does not overwrite outputs when the asset has moved to a newer version", async () => {
		await mediaAssets().updateOne({ _id: "asset-1" }, { $set: { version: 2 } });

		await completeItem({
			itemId: itemId("mp4_720"),
			status: "COMPLETE",
			output: { assetOutputs: { mp4_720: outputFor("mp4_720") } }
		});

		expect(await mediaAssets().findOne({ _id: "asset-1" })).toMatchObject({ outputs: {} });
	});

	it("repairs the handoff of an item that settled before a crash", async () => {
		await claimItem(itemId("mp4_360"), "msg-1", LEASE_SEC);
		await pipelineItems().updateOne(
			{ _id: itemId("mp4_360") },
			{
				$set: {
					status: "COMPLETE",
					completedAt: new Date(),
					output: { assetOutputs: { mp4_360: outputFor("mp4_360") } }
				}
			}
		);

		const claim = await claimItem(itemId("mp4_360"), "msg-redelivery", LEASE_SEC);
		expect(claim).toMatchObject({ claimed: false, reason: "terminal" });
		await completeItem({ itemId: itemId("mp4_360"), status: "COMPLETE" });

		expect(await mediaAssets().findOne({ _id: "asset-1" })).toMatchObject({
			outputs: { mp4_360: outputFor("mp4_360") }
		});
		expect(await requests().findOne({ _id: requestId })).toMatchObject({
			pendingItems: expect.not.arrayContaining([itemId("mp4_360")])
		});
		expect(sentCallbacks()).toEqual([expect.objectContaining({ deduplicationId: `${itemId("mp4_360")}:item` })]);
	});

	it("releases scenes exactly once when both of its dependencies complete concurrently", async () => {
		await claimItem(itemId("mp4_360"), "msg-a", LEASE_SEC);
		await claimItem(itemId("transcribe"), "msg-t", LEASE_SEC);

		await Promise.all([
			completeItem({ itemId: itemId("mp4_360"), status: "COMPLETE" }),
			completeItem({ itemId: itemId("transcribe"), status: "COMPLETE" })
		]);

		expect(await statusOf("scenes")).toBe("QUEUED");
		expect(sentTo("lambda-ai").length).toBeGreaterThanOrEqual(1);
	});

	it("finalizes exactly once when the last two items complete concurrently", async () => {
		for (const key of ["mp4_360", "audio", "mp4_720", "transcribe"]) {
			await claimAndComplete(key);
		}
		await claimItem(itemId("mp4_1080"), "msg-last", LEASE_SEC);
		await claimItem(itemId("scenes"), "msg-scenes", LEASE_SEC);

		await Promise.all([
			completeItem({ itemId: itemId("mp4_1080"), status: "COMPLETE", usage: lambdaUsage }),
			completeItem({ itemId: itemId("scenes"), status: "COMPLETE", usage: lambdaUsage })
		]);

		expect(await jobReports().countDocuments({ requestId })).toBe(1);
		expect(sentCallbacks().filter((message) => message.body.type === "request")).toHaveLength(1);
		expect(await requests().findOne({ _id: requestId })).toMatchObject({ status: "COMPLETE" });
	});

	it("rolls usage up per tier across a failed lambda attempt and a successful fargate attempt", async () => {
		await claimItem(itemId("mp4_360"), "msg-1", LEASE_SEC);
		await pipelineItems().updateOne(
			{ _id: itemId("mp4_360") },
			{ $push: { usage: { computeTier: "lambda", computeSec: 5, memoryMb: 3008 } } }
		);
		await completeItem({
			itemId: itemId("mp4_360"),
			status: "COMPLETE",
			usage: { computeTier: "fargate", computeSec: 10, memoryMb: 4096, vcpu: 2, spot: true, outputBytes: 500 }
		});
		for (const key of ["audio", "mp4_720", "mp4_1080", "transcribe", "scenes"]) {
			await claimAndComplete(key);
		}

		expect(await jobReports().findOne({ requestId })).toMatchObject({
			usage: {
				byTier: {
					lambda: { attempts: 6, computeSec: 15 },
					fargate: { attempts: 1, computeSec: 10, outputBytes: 500 }
				}
			},
			resourceUnits: { fargateSpotVcpuSeconds: 20, fargateSpotGbSeconds: 40, fargateVcpuSeconds: 0 }
		});
	});

	it("leaves the report unmarked when the usage_daily increment fails", async () => {
		await usageDaily().insertOne({
			_id: dayKey("account-1", new Date()),
			accountId: "account-1",
			date: new Date().toISOString().slice(0, 10),
			requests: 0,
			units: "corrupt"
		} as never);

		await expect(completeAll()).rejects.toThrow();

		expect(await jobReports().findOne({ requestId })).toBeNull();
		expect(await usageDaily().findOne({ _id: dayKey("account-1", new Date()) })).toMatchObject({ requests: 0 });
	});

	it("rejects an unknown item", async () => {
		await expect(completeItem({ itemId: "missing", status: "COMPLETE" })).rejects.toThrow(/missing/);
	});
});
