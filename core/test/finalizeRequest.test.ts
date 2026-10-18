import { ensureIndexes, jobReports, pipelineItems, requests, usageDaily } from "../src/models";
import { dayKey, loadRequest } from "../src/pipeline";
import { finalizeRequest } from "../src/pipeline/finalizeRequest";
import { computeResourceUnits } from "../src/pipeline/resourceUnits";
import * as unitsLedger from "../src/pipeline/unitsLedger";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";
import { insertStoredRequest, itemsOf } from "./helpers/pipelineFixtures";

jest.mock("../src/queue", () => require("./helpers/queueMock"));

const REQUEST_ID = "req-late";
const LAMBDA_USAGE = { computeTier: "lambda" as const, computeSec: 10, memoryMb: 2048 };

describe("finalizeRequest", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
	});

	it("counts the units of an item that settles after the snapshot and before the report is written, once", async () => {
		await insertStoredRequest(REQUEST_ID);
		const request = await loadRequest(REQUEST_ID);
		const lateItem = Object.values(await itemsOf(request)).find((item) => item.status === "QUEUED");
		if (lateItem === undefined) {
			throw new Error("expected a queued item");
		}
		const now = new Date();
		const loadItems = unitsLedger.loadItems;
		jest.spyOn(unitsLedger, "loadItems").mockImplementationOnce(async (requestId) => {
			const snapshot = await loadItems(requestId);
			await pipelineItems().updateOne(
				{ _id: lateItem._id },
				{ $set: { status: "COMPLETE", completedAt: now }, $push: { usage: LAMBDA_USAGE } }
			);
			const settled = await pipelineItems().findOne({ _id: lateItem._id });
			if (settled === null) {
				throw new Error("late item missing");
			}
			await unitsLedger.recordItemUnits(settled);
			return snapshot;
		});

		await finalizeRequest(request, now, { status: "CANCELLED" });

		const expected = computeResourceUnits([LAMBDA_USAGE]);
		const report = await jobReports().findOne({ _id: REQUEST_ID });
		expect(expected.lambdaGbSeconds).toBeGreaterThan(0);
		expect(report?.resourceUnits).toEqual(expected);
		expect(report?.unitsRecordedItems.filter((id) => id === lateItem._id)).toHaveLength(1);
		const daily = await usageDaily().findOne({ _id: dayKey("account-1", now) });
		expect(daily?.units.lambdaGbSeconds).toBe(expected.lambdaGbSeconds);
		expect((await requests().findOne({ _id: REQUEST_ID }))?.status).toBe("CANCELLED");
	});
});
