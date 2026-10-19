import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { deliverCallback, ensureIndexes } from "@helios/core";
import { resetConfigForTests } from "../../core/src/config";
import { callbackHandler } from "../src";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { itemMessage, REQUEST_ID, seedAccount, seedRequest } from "../../core/test/helpers/callbackFixtures";
import { sqsRecord } from "./helpers/records";

const mockChangeVisibility = jest.fn();

jest.mock("../../core/src/queue", () => ({
	...jest.requireActual("../../core/src/queue"),
	queueFor: () => ({ changeVisibility: mockChangeVisibility, send: jest.fn(), sendBatch: jest.fn() })
}));

jest.mock("../../core/src/callbacks", () => {
	const actual = jest.requireActual("../../core/src/callbacks");
	return { ...actual, deliverCallback: jest.fn(actual.deliverCallback) };
});

describe("callback handler", () => {
	const original = process.env;
	let server: Server;
	let base: string;
	let responseStatus: number;

	beforeAll(async () => {
		await startMongo();
		server = createServer((_req, res) => {
			res.writeHead(responseStatus).end();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		await stopMongo();
	});

	beforeEach(async () => {
		process.env = { ...original, SSRF_ALLOWED_HOSTS: "127.0.0.1", CALLBACK_TIMEOUT_SEC: "5" };
		resetConfigForTests();
		responseStatus = 200;
		mockChangeVisibility.mockReset();
		await resetDb();
		await ensureIndexes();
		await seedAccount({ type: "webhook", url: `${base}/hook` });
		await seedRequest(REQUEST_ID, { items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }] });
	});

	afterEach(() => {
		process.env = original;
		resetConfigForTests();
	});

	it("acknowledges a delivered callback", async () => {
		const result = await callbackHandler({
			Records: [sqsRecord("msg-1", itemMessage("encode:a"), { receiveCount: 1 })]
		});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(mockChangeVisibility).not.toHaveBeenCalled();
	});

	it("moves the message to the backoff for the attempt and reports it", async () => {
		responseStatus = 500;
		const result = await callbackHandler({
			Records: [sqsRecord("msg-2", itemMessage("encode:a"), { receiveCount: 2 })]
		});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-2" }] });
		expect(mockChangeVisibility).toHaveBeenCalledWith(
			expect.objectContaining({ id: "msg-2", receiptHandle: "rh-msg-2", receiveCount: 2 }),
			120
		);
	});

	it("reports a failure without a backoff for a request that does not exist", async () => {
		const result = await callbackHandler({
			Records: [sqsRecord("msg-3", { type: "request", requestId: "missing", sequence: 1 })]
		});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-3" }] });
		expect(mockChangeVisibility).not.toHaveBeenCalled();
	});

	it("passes the message sequence through to delivery", async () => {
		await callbackHandler({ Records: [sqsRecord("msg-5", { ...itemMessage("encode:a"), sequence: 3 })] });

		expect(deliverCallback).toHaveBeenCalledWith(expect.objectContaining({ sequence: 3 }), 1);
	});

	it("reports a failure for a malformed message body", async () => {
		const result = await callbackHandler({ Records: [sqsRecord("msg-4", { type: "bogus" })] });

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-4" }] });
		expect(mockChangeVisibility).not.toHaveBeenCalled();
	});
});
