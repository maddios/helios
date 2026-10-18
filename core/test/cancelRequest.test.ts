import { NotFoundError } from "@helios/contracts";
import { ensureIndexes, jobReports, pipelineItems, requests, usageDaily } from "../src/models";
import { cancelRequest, completeItem, dayKey } from "../src/pipeline";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";
import { insertStoredRequest, itemsOf, sentCallbacks } from "./helpers/pipelineFixtures";

jest.mock("../src/queue", () => require("./helpers/queueMock"));

const REQUEST_ID = "req-1";

function finalCallbacks(): number {
	return sentCallbacks().filter((body) => body.type === "request").length;
}

describe("cancelRequest", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
	});

	it("throws NotFoundError for a request of another account", async () => {
		await insertStoredRequest(REQUEST_ID);
		await expect(cancelRequest("account-2", REQUEST_ID)).rejects.toBeInstanceOf(NotFoundError);
		await expect(cancelRequest("account-1", "missing")).rejects.toBeInstanceOf(NotFoundError);
	});

	it("settles BLOCKED and QUEUED items as CANCELLED and writes the job report", async () => {
		await insertStoredRequest(REQUEST_ID);
		const request = await cancelRequest("account-1", REQUEST_ID);

		expect(request.status).toBe("CANCELLED");
		const items = await itemsOf(request);
		expect(Object.values(items).map((item) => item.status)).toEqual(Object.values(items).map(() => "CANCELLED"));
		expect((await jobReports().findOne({ _id: REQUEST_ID }))?.status).toBe("CANCELLED");
	});

	it("leaves IN_PROGRESS items untouched", async () => {
		await insertStoredRequest(REQUEST_ID);
		await pipelineItems().updateOne({ _id: `${REQUEST_ID}:mp4_360` }, { $set: { status: "IN_PROGRESS" } });

		await cancelRequest("account-1", REQUEST_ID);

		expect((await pipelineItems().findOne({ _id: `${REQUEST_ID}:mp4_360` }))?.status).toBe("IN_PROGRESS");
	});

	it("repairs a cancelled request that crashed before its job report was written", async () => {
		await insertStoredRequest(REQUEST_ID, { status: "CANCELLED" });

		const request = await cancelRequest("account-1", REQUEST_ID);

		expect(Object.values(await itemsOf(request)).map((item) => item.status)).toEqual(
			Object.values(await itemsOf(request)).map(() => "CANCELLED")
		);
		expect((await jobReports().findOne({ _id: REQUEST_ID }))?.status).toBe("CANCELLED");
		expect(finalCallbacks()).toBe(1);
	});

	it("records the units of an item that settles after cancel exactly once", async () => {
		await insertStoredRequest(REQUEST_ID);
		await pipelineItems().updateOne({ _id: `${REQUEST_ID}:mp4_360` }, { $set: { status: "IN_PROGRESS" } });
		await cancelRequest("account-1", REQUEST_ID);
		const usage = { computeTier: "lambda" as const, computeSec: 10, memoryMb: 1024 };

		await completeItem({ itemId: `${REQUEST_ID}:mp4_360`, status: "CANCELLED", usage });
		await completeItem({ itemId: `${REQUEST_ID}:mp4_360`, status: "CANCELLED", usage });

		const report = await jobReports().findOne({ _id: REQUEST_ID });
		expect(report?.resourceUnits.lambdaGbSeconds).toBe(10);
		expect(await usageDaily().findOne({ _id: dayKey("account-1", report?.createdAt ?? new Date()) })).toMatchObject({
			requests: 1,
			units: { lambdaGbSeconds: 10 }
		});
	});

	it("sends the final callback exactly once across repeated cancels", async () => {
		await insertStoredRequest(REQUEST_ID);
		await cancelRequest("account-1", REQUEST_ID);
		const callbacksAfterFirst = sentCallbacks().length;

		const again = await cancelRequest("account-1", REQUEST_ID);

		expect(again.status).toBe("CANCELLED");
		expect(finalCallbacks()).toBe(1);
		expect(sentCallbacks().length).toBe(callbacksAfterFirst);
	});

	it("does not re-finalize when a later item completes", async () => {
		await insertStoredRequest(REQUEST_ID);
		await pipelineItems().updateOne({ _id: `${REQUEST_ID}:mp4_360` }, { $set: { status: "IN_PROGRESS" } });
		await cancelRequest("account-1", REQUEST_ID);

		await completeItem({ itemId: `${REQUEST_ID}:mp4_360`, status: "COMPLETE" });

		expect(finalCallbacks()).toBe(1);
		expect((await requests().findOne({ _id: REQUEST_ID }))?.status).toBe("CANCELLED");
	});

	it("returns a COMPLETE request unchanged without sending callbacks", async () => {
		await insertStoredRequest(REQUEST_ID, { status: "COMPLETE" });

		const request = await cancelRequest("account-1", REQUEST_ID);

		expect(request.status).toBe("COMPLETE");
		expect(sentCallbacks()).toEqual([]);
	});
});
