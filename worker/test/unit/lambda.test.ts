import type { Context, SQSEvent, SQSRecord } from "aws-lambda";
import { claimItem, initDb, queueFromArn } from "@helios/core";
import { handler } from "../../src/lambda";
import { processItem, type ProcessItemInput } from "../../src/processItem";

jest.mock("@helios/core", () => ({
	...jest.requireActual("@helios/core"),
	initDb: jest.fn(),
	queueFromArn: jest.fn(),
	claimItem: jest.fn(),
	completeItem: jest.fn(),
	contextLogger: jest.fn(() => ({ error: jest.fn() }))
}));
jest.mock("../../src/processItem", () => ({ processItem: jest.fn() }));

const ARN = "arn:aws:sqs:us-east-2:123456789012:helios-test-lambda-p1";
const actualProcessItem =
	jest.requireActual<typeof import("../../src/processItem")>("../../src/processItem").processItem;

function record(body: string = JSON.stringify({ itemId: "req-1:mp4_360" })): SQSRecord {
	return {
		messageId: "msg-1",
		receiptHandle: "handle-1",
		body,
		eventSourceARN: ARN,
		attributes: { ApproximateReceiveCount: "1" }
	} as unknown as SQSRecord;
}

function event(...records: SQSRecord[]): SQSEvent {
	return { Records: records } as SQSEvent;
}

function context(remainingMs: number): Context {
	return { getRemainingTimeInMillis: () => remainingMs, callbackWaitsForEmptyEventLoop: true } as unknown as Context;
}

const FAILED = { batchItemFailures: [{ itemIdentifier: "msg-1" }] };
const SUCCEEDED = { batchItemFailures: [] };

describe("encoder lambda handler", () => {
	beforeEach(() => {
		jest.mocked(queueFromArn).mockReturnValue({ changeVisibility: jest.fn() } as never);
		jest.mocked(processItem).mockReset();
	});

	describe("result mapping", () => {
		it("throws for a batch that is not exactly one record, so the whole batch is retried", async () => {
			await expect(handler(event(record(), record()), context(60_000))).rejects.toThrow(
				"Expected one SQS record per invocation, got 2"
			);

			expect(processItem).not.toHaveBeenCalled();
		});

		it.each([
			["done", SUCCEEDED],
			["redeliver", FAILED],
			["interrupted", FAILED]
		] as const)("maps a %s outcome of processItem", async (outcome, expected) => {
			jest.mocked(processItem).mockResolvedValue(outcome);

			await expect(handler(event(record()), context(60_000))).resolves.toEqual(expected);
		});

		it("returns the message for redelivery when processing throws", async () => {
			jest.mocked(processItem).mockRejectedValue(new Error("mongo down"));

			await expect(handler(event(record()), context(60_000))).resolves.toEqual(FAILED);
		});

		it("returns the message for redelivery without touching the database when the body is malformed", async () => {
			await expect(handler(event(record("not json")), context(60_000))).resolves.toEqual(FAILED);

			expect(initDb).not.toHaveBeenCalled();
			expect(processItem).not.toHaveBeenCalled();
		});

		it("passes the item, message, queue visibility and a lease-keeping abort policy to processItem", async () => {
			jest.mocked(processItem).mockResolvedValue("done");
			const changeVisibility = jest.fn().mockResolvedValue(undefined);
			jest.mocked(queueFromArn).mockReturnValue({ changeVisibility } as never);

			await handler(event(record()), context(60_000));
			const input = jest.mocked(processItem).mock.calls[0][0] as ProcessItemInput;
			await input.extendVisibility(120);

			expect(queueFromArn).toHaveBeenCalledWith(ARN);
			expect(input).toMatchObject({ itemId: "req-1:mp4_360", messageId: "msg-1", releaseLeaseOnAbort: false });
			expect(changeVisibility).toHaveBeenCalledWith({ receiptHandle: "handle-1" }, 120);
		});

		it("turns off waiting for the event loop so the open database connection does not hold the response", async () => {
			jest.mocked(processItem).mockResolvedValue("done");
			const lambdaContext = context(60_000);

			await handler(event(record()), lambdaContext);

			expect(lambdaContext.callbackWaitsForEmptyEventLoop).toBe(false);
		});
	});

	describe("timeout", () => {
		beforeEach(() => {
			jest.useFakeTimers();
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it("aborts the attempt ten seconds before the Lambda timeout and returns the message", async () => {
			let attemptSignal: AbortSignal | undefined;
			jest.mocked(processItem).mockImplementation(async (input) => {
				attemptSignal = input.signal;
				await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
				return "interrupted";
			});

			const result = handler(event(record()), context(10_500));
			await jest.advanceTimersByTimeAsync(499);
			expect(attemptSignal?.aborted).toBe(false);
			await jest.advanceTimersByTimeAsync(1);

			await expect(result).resolves.toEqual(FAILED);
			expect(attemptSignal?.reason).toEqual(new Error("Lambda timeout approaching"));
		});
	});

	describe("with the real processItem and a busy claim", () => {
		beforeEach(() => {
			jest.mocked(processItem).mockImplementation(actualProcessItem);
		});

		it("returns the message when the busy holder is this same message", async () => {
			jest.mocked(claimItem).mockResolvedValue({ claimed: false, reason: "busy", messageId: "msg-1" });

			await expect(handler(event(record()), context(60_000))).resolves.toEqual(FAILED);
		});

		it("acks the message when a different message holds the lease", async () => {
			jest.mocked(claimItem).mockResolvedValue({ claimed: false, reason: "busy", messageId: "msg-other" });

			await expect(handler(event(record()), context(60_000))).resolves.toEqual(SUCCEEDED);
		});
	});
});
