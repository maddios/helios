import {
	callbackDeliveries,
	ensureIndexes,
	pipelineItems,
	requests,
	callbackEventId,
	type CallbackMessage
} from "@helios/core";
import { dlqHandler } from "../src";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import {
	itemId,
	itemMessage,
	REQUEST_ID,
	seedAccount,
	seedRequest,
	SECRET
} from "../../core/test/helpers/callbackFixtures";
import { sqsRecord } from "./helpers/records";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));

const FARGATE_P1 = "fargate-p1-dlq";
const FARGATE_P3 = "fargate-p3-dlq";
const ANALYZE = "analyze-dlq";
const CALLBACKS = "callbacks-dlq.fifo";

async function dead(queue: string, body: unknown, messageId = "dead-1") {
	return dlqHandler({ Records: [sqsRecord(messageId, body, { queue })] });
}

describe("dlq handler", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await seedAccount();
	});

	it("settles a dead encode item as ERROR with its stored error and finishes the request", async () => {
		await seedRequest(REQUEST_ID, {
			items: [{ key: "encode:a", kind: "encode", status: "IN_PROGRESS", error: "ffmpeg crashed" }]
		});

		const result = await dead(FARGATE_P1, { itemId: itemId("encode:a") });

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await pipelineItems().findOne({ _id: itemId("encode:a") })).toMatchObject({
			status: "ERROR",
			error: "ffmpeg crashed"
		});
		expect(await requests().findOne({ _id: REQUEST_ID })).toMatchObject({ status: "ERROR" });
	});

	it("settles a dead optional scenes item as SKIPPED", async () => {
		await seedRequest(REQUEST_ID, { items: [{ key: "scenes", kind: "scenes", status: "QUEUED" }] });

		await dead(FARGATE_P3, { itemId: itemId("scenes") });

		expect(await pipelineItems().findOne({ _id: itemId("scenes") })).toMatchObject({ status: "SKIPPED" });
		expect(await requests().findOne({ _id: REQUEST_ID })).toMatchObject({ status: "COMPLETE" });
	});

	it("settles a dead optional transcribe item as SKIPPED", async () => {
		await seedRequest(REQUEST_ID, { items: [{ key: "transcribe", kind: "transcribe", status: "QUEUED" }] });

		await dead(FARGATE_P3, { itemId: itemId("transcribe") });

		expect(await pipelineItems().findOne({ _id: itemId("transcribe") })).toMatchObject({ status: "SKIPPED" });
	});

	it("is idempotent when the same dead item is delivered again", async () => {
		await seedRequest(REQUEST_ID, { items: [{ key: "encode:a", kind: "encode", status: "QUEUED" }] });
		const body = { itemId: itemId("encode:a") };

		await dead(FARGATE_P1, body, "dead-1");
		const second = await dead(FARGATE_P1, body, "dead-2");

		expect(second).toEqual({ batchItemFailures: [] });
		expect(await pipelineItems().findOne({ _id: itemId("encode:a") })).toMatchObject({ status: "ERROR" });
		expect(await requests().findOne({ _id: REQUEST_ID })).toMatchObject({ status: "ERROR" });
	});

	it("fails an analyze request that exhausted its retries", async () => {
		await seedRequest(REQUEST_ID, { status: "ANALYZING" });

		const result = await dead(ANALYZE, { requestId: REQUEST_ID });

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await requests().findOne({ _id: REQUEST_ID })).toMatchObject({
			status: "ERROR",
			error: { code: "analyze_failed" }
		});
	});

	it("marks a dead callback delivery as failed", async () => {
		const message: CallbackMessage = itemMessage("encode:a");
		await callbackDeliveries().insertOne({
			_id: callbackEventId(message),
			requestId: REQUEST_ID,
			accountId: "account-1",
			event: "item.completed",
			status: "PENDING",
			payload: { secret: SECRET },
			attempts: [],
			createdAt: new Date()
		});

		await dead(CALLBACKS, message);

		expect(await callbackDeliveries().findOne({ _id: callbackEventId(message) })).toMatchObject({ status: "FAILED" });
	});

	it("acknowledges a dead item that no longer exists", async () => {
		const result = await dead(FARGATE_P1, { itemId: "missing-item" });

		expect(result).toEqual({ batchItemFailures: [] });
	});

	it("acknowledges a dead analyze message for a request that no longer exists", async () => {
		const result = await dead(ANALYZE, { requestId: "missing-request" });

		expect(result).toEqual({ batchItemFailures: [] });
	});

	it("acknowledges a dead callback whose delivery was never recorded", async () => {
		const result = await dead(CALLBACKS, itemMessage("encode:a"));

		expect(result).toEqual({ batchItemFailures: [] });
	});

	it("reports a failure for a queue without a dead-letter route", async () => {
		const result = await dead("lambda-p1-dlq", { itemId: "x" }, "dead-9");

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "dead-9" }] });
	});
});
