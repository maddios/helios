import { ensureIndexes, requests } from "@helios/core";
import { analyzeHandler } from "../src";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { REQUEST_ID, seedAccount, seedRequest } from "../../core/test/helpers/callbackFixtures";
import { sqsRecord } from "./helpers/records";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));

describe("analyze handler", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await seedAccount();
	});

	it("launches an analyzed request", async () => {
		await seedRequest(REQUEST_ID, { status: "ANALYZING" });

		const result = await analyzeHandler({
			Records: [sqsRecord("msg-1", { requestId: REQUEST_ID }, { queue: "analyze" })]
		});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await requests().findOne({ _id: REQUEST_ID })).toMatchObject({ status: "IN_PROGRESS" });
	});

	it("reports a failure for a request that does not exist", async () => {
		const result = await analyzeHandler({
			Records: [sqsRecord("msg-2", { requestId: "missing" }, { queue: "analyze" })]
		});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-2" }] });
	});

	it("rejects a batch that is not exactly one record", async () => {
		await expect(
			analyzeHandler({
				Records: [
					sqsRecord("msg-4", { requestId: REQUEST_ID }, { queue: "analyze" }),
					sqsRecord("msg-5", { requestId: REQUEST_ID }, { queue: "analyze" })
				]
			})
		).rejects.toThrow("Expected one SQS record per invocation, got 2");
	});

	it("reports a failure for a malformed message body", async () => {
		const result = await analyzeHandler({ Records: [sqsRecord("msg-3", "not json", { queue: "analyze" })] });

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-3" }] });
	});
});
