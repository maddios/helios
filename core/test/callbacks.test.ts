import { ConflictError, NotFoundError, TooManyRequestsError } from "@helios/contracts";
import {
	callbackDeliveries,
	ensureIndexes,
	requests,
	type CallbackDelivery,
	type PipelineRequest
} from "../src/models";
import { listDeliveries, redeliver } from "../src/callbacks";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

const mockSend = jest.fn();

jest.mock("../src/queue", () => ({
	...jest.requireActual("../src/queue"),
	queueFor: jest.fn(() => ({ send: mockSend }))
}));

function delivery(id: string, accountId: string, createdAt: Date): CallbackDelivery {
	return {
		_id: id,
		requestId: "req-1",
		accountId,
		event: "request.complete",
		payload: { type: "request" },
		attempts: [],
		createdAt
	};
}

function request(id: string, accountId: string, status: PipelineRequest["status"]): PipelineRequest {
	return {
		_id: id,
		accountId,
		assetId: "asset-1",
		clientRequestId: `client-${id}`,
		mode: "purge",
		analyze: "sync",
		assetVersion: 1,
		pendingItems: [],
		status,
		createdAt: new Date()
	};
}

describe("callbacks", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
	});

	describe("listDeliveries", () => {
		it("returns only the account's deliveries sorted by createdAt", async () => {
			await callbackDeliveries().insertMany([
				delivery("d-2", "acc-1", new Date("2026-03-02")),
				delivery("d-1", "acc-1", new Date("2026-03-01")),
				delivery("d-other", "acc-2", new Date("2026-03-01"))
			]);

			const deliveries = await listDeliveries("acc-1", "req-1");

			expect(deliveries.map((item) => item._id)).toEqual(["d-1", "d-2"]);
		});
	});

	describe("redeliver", () => {
		it("rejects an unknown request", async () => {
			await expect(redeliver("acc-1", "missing", 0)).rejects.toBeInstanceOf(NotFoundError);
		});

		it("rejects another account's request", async () => {
			await requests().insertOne(request("req-1", "acc-2", "COMPLETE"));

			await expect(redeliver("acc-1", "req-1", 0)).rejects.toBeInstanceOf(NotFoundError);
			expect(mockSend).not.toHaveBeenCalled();
		});

		it("rejects a request still in progress", async () => {
			await requests().insertOne(request("req-1", "acc-1", "IN_PROGRESS"));
			await requests().insertOne(request("req-2", "acc-1", "ANALYZING"));
			await expect(redeliver("acc-1", "req-2", 0)).rejects.toBeInstanceOf(ConflictError);

			await expect(redeliver("acc-1", "req-1", 0)).rejects.toBeInstanceOf(ConflictError);
			expect(mockSend).not.toHaveBeenCalled();
		});

		it("refuses a redelivery inside the cooldown with the seconds left", async () => {
			await requests().insertOne(request("req-1", "acc-1", "COMPLETE"));
			await redeliver("acc-1", "req-1", 60);

			const err = await redeliver("acc-1", "req-1", 60).catch((caught: unknown) => caught);

			expect(err).toBeInstanceOf(TooManyRequestsError);
			expect(err).toMatchObject({ code: "redeliver_cooldown", httpStatus: 429 });
			expect((err as TooManyRequestsError).retryAfterSec).toBeGreaterThan(0);
			expect(mockSend).toHaveBeenCalledTimes(1);
		});

		it("sends a callback with a fresh deduplicationId on every call", async () => {
			await requests().insertOne(request("req-1", "acc-1", "COMPLETE"));

			await redeliver("acc-1", "req-1", 0);
			await redeliver("acc-1", "req-1", 0);

			expect(mockSend).toHaveBeenCalledTimes(2);
			expect(mockSend).toHaveBeenCalledWith({
				body: { type: "request", requestId: "req-1" },
				groupId: "req-1",
				deduplicationId: expect.any(String)
			});
			const [first, second] = mockSend.mock.calls.map((call) => call[0].deduplicationId);
			expect(first).not.toBe(second);
		});
	});
});
