import { ensureIndexes, mediaAssets, requests } from "../src/models";
import { createRequest, failRequest } from "../src/pipeline";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";
import {
	asset,
	createInput,
	insertStoredRequest,
	sentCallbacks,
	totalSendCalls,
	unanalyzedAsset
} from "./helpers/pipelineFixtures";

jest.mock("../src/queue", () => require("./helpers/queueMock"));

describe("failRequest", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await mediaAssets().insertMany([asset, unanalyzedAsset]);
	});

	it("finalizes an ANALYZING request as ERROR with the message and sends the final callback", async () => {
		const { request } = await createRequest(createInput({ requestId: "req-fail", asset: unanalyzedAsset }));

		await failRequest(request._id, { code: "unprocessable_source", message: "Source is not media" });

		expect(await requests().findOne({ _id: request._id })).toMatchObject({
			status: "ERROR",
			error: { code: "unprocessable_source", message: "Source is not media" },
			completedAt: expect.any(Date)
		});
		expect(sentCallbacks()).toEqual([{ type: "request", requestId: request._id, sequence: 1 }]);
		expect(totalSendCalls()).toBe(0);
	});

	it("leaves CANCELLED and COMPLETE requests alone", async () => {
		await insertStoredRequest("req-cancelled", { itemKeys: [], status: "CANCELLED" });
		await insertStoredRequest("req-complete", { itemKeys: [], status: "COMPLETE" });

		await failRequest("req-cancelled", { code: "boom", message: "boom" });
		await failRequest("req-complete", { code: "boom", message: "boom" });

		for (const [id, status] of [
			["req-cancelled", "CANCELLED"],
			["req-complete", "COMPLETE"]
		] as const) {
			const request = await requests().findOne({ _id: id });
			expect(request).toMatchObject({ status });
			expect(request).not.toHaveProperty("error");
		}
		expect(sentCallbacks()).toEqual([]);
	});
});
