import { NotFoundError } from "@helios/contracts";
import { ensureIndexes, mediaAssets, pipelineItems, requests } from "../src/models";
import { completeItem, requestPurge } from "../src/pipeline";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";
import { asset, insertStoredRequest, sentCallbacks, sentMessages, sendBatchOf } from "./helpers/pipelineFixtures";

jest.mock("../src/queue", () => require("./helpers/queueMock"));

async function purgeRequests() {
	return requests().find({ mode: "purge" }).toArray();
}

describe("requestPurge", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await mediaAssets().insertOne(asset);
	});

	it("tombstones the asset and cancels its in-flight requests", async () => {
		await insertStoredRequest("req-open", { status: "IN_PROGRESS" });
		await insertStoredRequest("req-done", { status: "COMPLETE" });

		await requestPurge("account-1", "asset-1");

		expect((await mediaAssets().findOne({ _id: "asset-1" }))?.deletedAt).toBeInstanceOf(Date);
		expect((await requests().findOne({ _id: "req-open" }))?.status).toBe("CANCELLED");
		expect((await requests().findOne({ _id: "req-done" }))?.status).toBe("COMPLETE");
	});

	it("creates one purge request with a single QUEUED purge item on fargate-p2", async () => {
		const request = await requestPurge("account-1", "asset-1");

		expect(request).toMatchObject({ mode: "purge", clientRequestId: "purge:asset-1", status: "IN_PROGRESS" });
		const items = await pipelineItems().find({ requestId: request._id }).toArray();
		expect(items).toMatchObject([
			{ _id: `${request._id}:purge`, kind: "purge", queue: "fargate-p2", status: "QUEUED" }
		]);
		expect(sentMessages("fargate-p2").map((message) => message.body)).toEqual([{ itemId: `${request._id}:purge` }]);
	});

	it("is idempotent on repeat", async () => {
		const first = await requestPurge("account-1", "asset-1");
		const second = await requestPurge("account-1", "asset-1");

		expect(second._id).toBe(first._id);
		expect(await purgeRequests()).toHaveLength(1);
		expect(sendBatchOf("fargate-p2")).toHaveBeenCalledTimes(1);
	});

	it("sends the asset.deleted callback once the purge item completes", async () => {
		const request = await requestPurge("account-1", "asset-1");

		await completeItem({ itemId: `${request._id}:purge`, status: "COMPLETE", output: {} });

		expect(sentCallbacks()).toContainEqual({ type: "request", requestId: request._id, sequence: 2 });
	});

	it("throws NotFoundError for an unknown asset", async () => {
		await expect(requestPurge("account-2", "asset-1")).rejects.toBeInstanceOf(NotFoundError);
	});
});
