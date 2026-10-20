import {
	cdnInvalidations,
	db,
	ensureIndexes,
	objectStore,
	pipelineItems,
	UsageMeter,
	type PipelineItem
} from "@helios/core";
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
	source: { type: "file", fileId: "file-1", key: `${SLUG}/files/file-1/clip.mp4` }
};

function fakeStore(initialKeys: string[]) {
	const keys = new Set(initialKeys);
	const log: string[] = [];
	return {
		keys,
		log,
		listKeys: jest.fn(async (prefix: string) => {
			log.push(`list ${prefix}`);
			return [...keys].filter((key) => key.startsWith(prefix));
		}),
		deleteKeys: jest.fn(async (toDelete: string[]) => {
			log.push(`delete ${toDelete.join(",")}`);
			toDelete.forEach((key) => keys.delete(key));
		})
	};
}

function contextFor(): HandlerContext {
	return {
		item: { _id: `${PURGE_REQUEST}:purge` } as PipelineItem,
		request: { _id: PURGE_REQUEST } as HandlerContext["request"],
		asset: ASSET as HandlerContext["asset"],
		account: { slug: SLUG } as HandlerContext["account"],
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

	it("deletes the asset's media and source copies and its documents, keeping the purge item and the stored file", async () => {
		const store = fakeStore([
			`${SLUG}/media/asset-1/mp4_360.mp4`,
			`${SLUG}/media/asset-1/tmb/0001.jpg`,
			`resize_cache/${SLUG}/media/asset-1/_img/w_100/tmb/0001.jpg`,
			`${SLUG}/sources/asset-1/original`,
			`${SLUG}/files/file-1/clip.mp4`,
			`${SLUG}/media/asset-2/mp4_360.mp4`
		]);
		jest.mocked(objectStore).mockReturnValue(store as never);

		await purgeHandler(contextFor());

		expect([...store.keys].sort()).toEqual([`${SLUG}/files/file-1/clip.mp4`, `${SLUG}/media/asset-2/mp4_360.mp4`]);
		expect(await cdnInvalidations().findOne({ _id: `${PURGE_REQUEST}:purge` })).toEqual(
			expect.objectContaining({ paths: [`/${SLUG}/media/asset-1/*`], status: "PENDING" })
		);
		expect(await db().collection("transcripts").countDocuments({})).toBe(1);
		expect(await db().collection("scene_analyses").countDocuments({})).toBe(0);
		expect((await pipelineItems().find({}).toArray()).map((item) => item._id)).toEqual([`${PURGE_REQUEST}:purge`]);
	});

	it("deletes originals before listing and deleting the resize cache", async () => {
		const store = fakeStore([
			`${SLUG}/media/asset-1/mp4_360.mp4`,
			`resize_cache/${SLUG}/media/asset-1/_img/w_100/tmb/0001.jpg`
		]);
		jest.mocked(objectStore).mockReturnValue(store as never);

		await purgeHandler(contextFor());

		expect(store.log.indexOf(`delete ${SLUG}/media/asset-1/mp4_360.mp4`)).toBeLessThan(
			store.log.indexOf(`list resize_cache/${SLUG}/media/asset-1/`)
		);
		expect(store.keys.size).toBe(0);
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
