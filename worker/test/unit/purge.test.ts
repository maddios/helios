import { db, ensureIndexes, objectStore, pipelineItems, UsageMeter, type PipelineItem } from "@helios/core";
import { purgeHandler } from "../../src/handlers/purge";
import type { HandlerContext } from "../../src/handlers/types";
import { resetDb, startMongo, stopMongo } from "../../../core/test/helpers/mongo";

jest.mock("@helios/core", () => ({
	...jest.requireActual("@helios/core"),
	objectStore: jest.fn()
}));

const PURGE_REQUEST = "req-purge";
const SLUG = "acme";
const ASSET = {
	_id: "asset-1",
	accountId: "account-1",
	source: { type: "upload", key: `${SLUG}/uploads/up-1` }
};

function fakeStore(initialKeys: string[]) {
	const keys = new Set(initialKeys);
	return {
		keys,
		listKeys: jest.fn(async (prefix: string) => [...keys].filter((key) => key.startsWith(prefix))),
		deleteKeys: jest.fn(async (toDelete: string[]) => {
			toDelete.forEach((key) => keys.delete(key));
		})
	};
}

function contextFor(): HandlerContext {
	return {
		item: { _id: `${PURGE_REQUEST}:purge` } as PipelineItem,
		request: { _id: PURGE_REQUEST } as HandlerContext["request"],
		asset: ASSET as HandlerContext["asset"],
		slug: SLUG,
		workDir: "/unused",
		signal: new AbortController().signal,
		meter: new UsageMeter(),
		reportProgress: () => undefined
	};
}

describe("purge handler", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await db().collection("transcripts").insertOne({ accountId: "account-1", assetId: "asset-1" });
		await db().collection("scene_analyses").insertOne({ accountId: "account-1", assetId: "asset-1" });
		await db().collection("transcripts").insertOne({ accountId: "account-1", assetId: "asset-2" });
		await pipelineItems().insertMany([
			{ _id: "req-1:encode", requestId: "req-1", assetId: "asset-1", accountId: "account-1" },
			{ _id: `${PURGE_REQUEST}:purge`, requestId: PURGE_REQUEST, assetId: "asset-1", accountId: "account-1" }
		] as unknown as PipelineItem[]);
	});

	it("deletes the asset's media, source copies and upload, and its documents, keeping the purge item", async () => {
		const store = fakeStore([
			`${SLUG}/media/asset-1/mp4_360.mp4`,
			`${SLUG}/media/asset-1/tmb/0001.jpg`,
			`${SLUG}/sources/asset-1/original`,
			`${SLUG}/uploads/up-1`,
			`${SLUG}/media/asset-2/mp4_360.mp4`
		]);
		jest.mocked(objectStore).mockReturnValue(store as never);

		await purgeHandler(contextFor());

		expect([...store.keys]).toEqual([`${SLUG}/media/asset-2/mp4_360.mp4`]);
		expect(await db().collection("transcripts").countDocuments({})).toBe(1);
		expect(await db().collection("scene_analyses").countDocuments({})).toBe(0);
		expect((await pipelineItems().find({}).toArray()).map((item) => item._id)).toEqual([`${PURGE_REQUEST}:purge`]);
	});

	it("throws while another item of the asset holds a fresh lease", async () => {
		await pipelineItems().updateOne(
			{ _id: "req-1:encode" },
			{ $set: { status: "IN_PROGRESS", heartbeatAt: new Date() } }
		);
		const store = fakeStore([`${SLUG}/media/asset-1/mp4_360.mp4`]);
		jest.mocked(objectStore).mockReturnValue(store as never);

		await expect(purgeHandler(contextFor())).rejects.toThrow(/still running/);

		expect(store.keys.size).toBe(1);
	});

	it("proceeds when the other item's lease is stale", async () => {
		const stale = new Date(Date.now() - 10 * 60 * 1000);
		await pipelineItems().updateOne({ _id: "req-1:encode" }, { $set: { status: "IN_PROGRESS", heartbeatAt: stale } });
		jest.mocked(objectStore).mockReturnValue(fakeStore([]) as never);

		await expect(purgeHandler(contextFor())).resolves.toEqual({ output: {}, outputBytes: 0 });
	});

	it("is idempotent on a second run", async () => {
		const store = fakeStore([`${SLUG}/media/asset-1/mp4_360.mp4`]);
		jest.mocked(objectStore).mockReturnValue(store as never);
		await purgeHandler(contextFor());

		await expect(purgeHandler(contextFor())).resolves.toEqual({ output: {}, outputBytes: 0 });

		expect(store.keys.size).toBe(0);
		expect(await pipelineItems().countDocuments({})).toBe(1);
	});
});
