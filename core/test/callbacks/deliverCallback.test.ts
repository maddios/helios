import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
	WEBHOOK_EVENT_HEADER,
	WEBHOOK_EVENT_ID_HEADER,
	WEBHOOK_SIGNATURE_HEADER,
	WEBHOOK_TOLERANCE_SEC,
	WebhookEventSchema
} from "@helios/contracts";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { mockClient } from "aws-sdk-client-mock";
import { accounts, callbackDeliveries, ensureIndexes } from "../../src/models";
import {
	backoffSec,
	callbackEventId,
	CallbackDeliveryError,
	deliverCallback,
	markDeliveryFailed,
	MAX_PAYLOAD_BYTES,
	resetCallbacksConfigForTests
} from "../../src/callbacks";
import { resetConfigForTests } from "../../src/config";
import { verifySignature } from "../../src/webhooks";
import { resetDb, startMongo, stopMongo } from "../helpers/mongo";
import { itemMessage, REQUEST_ID, SECRET, seedAccount, seedReport, seedRequest } from "../helpers/callbackFixtures";

jest.mock("../../src/queue", () => require("../helpers/queueMock"));

const eventBridgeMock = mockClient(EventBridgeClient);
const EVENT_BUS_ARN = "arn:aws:events:us-east-2:123456789012:event-bus/customer-bus";

interface Received {
	path: string;
	headers: IncomingHttpHeaders;
	body: string;
}

describe("deliverCallback", () => {
	const original = process.env;
	let server: Server;
	let base: string;
	let received: Received[];
	let responseStatus: number;

	beforeAll(async () => {
		await startMongo();
		server = createServer((req, res) => {
			if (req.url === "/hang") {
				return;
			}
			let body = "";
			req.setEncoding("utf8").on("data", (chunk: string) => {
				body += chunk;
			});
			req.on("end", () => {
				received.push({ path: req.url ?? "", headers: req.headers, body });
				res.writeHead(responseStatus, { location: "/followed" }).end();
			});
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
		process.env = { ...original, SSRF_ALLOWED_HOSTS: "127.0.0.1", CALLBACK_TIMEOUT_SEC: "1" };
		resetConfigForTests();
		resetCallbacksConfigForTests();
		received = [];
		responseStatus = 200;
		eventBridgeMock.reset();
		await resetDb();
		await ensureIndexes();
		await seedAccount({ type: "webhook", url: `${base}/hook` });
	});

	afterEach(() => {
		process.env = original;
		resetConfigForTests();
		resetCallbacksConfigForTests();
	});

	it("posts a signed item event and records a delivered attempt", async () => {
		const message = itemMessage("encode:a");
		await seedRequest(REQUEST_ID, { items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }] });

		await deliverCallback(message, 1);

		expect(received).toHaveLength(1);
		const [{ headers, body }] = received;
		const nowSec = Math.floor(Date.now() / 1000);
		expect(
			verifySignature(
				SECRET,
				String(headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()]),
				body,
				nowSec,
				WEBHOOK_TOLERANCE_SEC
			)
		).toBe(true);
		expect(headers[WEBHOOK_EVENT_ID_HEADER.toLowerCase()]).toBe(callbackEventId(message));
		expect(headers[WEBHOOK_EVENT_HEADER.toLowerCase()]).toBe("item.completed");
		expect(WebhookEventSchema.safeParse(JSON.parse(body)).success).toBe(true);

		const delivery = await callbackDeliveries().findOne({ _id: callbackEventId(message) });
		expect(delivery).toMatchObject({
			status: "DELIVERED",
			deliveredAt: expect.any(Date),
			attempts: [{ status: "DELIVERED", httpStatus: 200 }]
		});
		expect(delivery?.payload).toEqual(JSON.parse(body));
	});

	it("posts a request event to the request destination ahead of the account destination", async () => {
		await seedRequest(REQUEST_ID, { status: "COMPLETE", destination: { type: "webhook", url: `${base}/request` } });
		await seedReport(REQUEST_ID, "COMPLETE");

		await deliverCallback({ type: "request", requestId: REQUEST_ID, sequence: 1 }, 1);

		expect(received.map(({ path }) => path)).toEqual(["/request"]);
		expect(received[0]?.headers[WEBHOOK_EVENT_HEADER.toLowerCase()]).toBe("request.completed");
	});

	it("puts a request event on an EventBridge destination", async () => {
		eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: "e-1" }] });
		await seedRequest(REQUEST_ID, {
			status: "COMPLETE",
			destination: { type: "eventbridge", eventBusArn: EVENT_BUS_ARN }
		});
		await seedReport(REQUEST_ID, "COMPLETE");

		await deliverCallback({ type: "request", requestId: REQUEST_ID, sequence: 1 }, 1);

		expect(received).toEqual([]);
		const [call] = eventBridgeMock.commandCalls(PutEventsCommand);
		expect(call?.args[0].input.Entries?.[0]).toMatchObject({
			EventBusName: EVENT_BUS_ARN,
			Source: "helios.account-1",
			DetailType: "request.completed"
		});
		const delivery = await callbackDeliveries().findOne({ requestId: REQUEST_ID });
		expect(delivery).toMatchObject({
			destinationType: "eventbridge",
			status: "DELIVERED",
			attempts: [{ status: "DELIVERED" }]
		});
	});

	it("records a failed attempt and asks for the backoff on a non-2xx response", async () => {
		responseStatus = 500;
		const message = itemMessage("encode:a");
		await seedRequest(REQUEST_ID, { items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }] });

		const failure = deliverCallback(message, 2);

		await expect(failure).rejects.toBeInstanceOf(CallbackDeliveryError);
		await expect(failure).rejects.toMatchObject({ backoffSec: 120 });
		const delivery = await callbackDeliveries().findOne({ _id: callbackEventId(message) });
		expect(delivery).toMatchObject({
			status: "PENDING",
			attempts: [{ status: "FAILED", httpStatus: 500, error: "Receiver responded with status 500" }]
		});
		expect(delivery?.deliveredAt).toBeUndefined();
	});

	it("does not follow a redirect", async () => {
		responseStatus = 302;
		const message = itemMessage("encode:a");
		await seedRequest(REQUEST_ID, { items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }] });

		await expect(deliverCallback(message, 1)).rejects.toBeInstanceOf(CallbackDeliveryError);

		expect(received.map(({ path }) => path)).toEqual(["/hook"]);
		const delivery = await callbackDeliveries().findOne({ _id: callbackEventId(message) });
		expect(delivery?.attempts[0]).toMatchObject({ status: "FAILED", httpStatus: 302 });
	});

	it("records a network failure without an http status", async () => {
		const message = itemMessage("encode:a");
		await seedRequest(REQUEST_ID, {
			items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }],
			destination: { type: "webhook", url: "http://127.0.0.1:1/hook" }
		});

		await expect(deliverCallback(message, 1)).rejects.toMatchObject({ backoffSec: 30 });

		const delivery = await callbackDeliveries().findOne({ _id: callbackEventId(message) });
		expect(delivery?.attempts).toEqual([{ at: expect.any(Date), status: "FAILED", error: expect.any(String) }]);
	});

	it("gives up on a receiver that never responds after CALLBACK_TIMEOUT_SEC", async () => {
		const message = itemMessage("encode:a");
		await seedRequest(REQUEST_ID, {
			items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }],
			destination: { type: "webhook", url: `${base}/hang` }
		});

		await expect(deliverCallback(message, 1)).rejects.toBeInstanceOf(CallbackDeliveryError);

		const delivery = await callbackDeliveries().findOne({ _id: callbackEventId(message) });
		expect(delivery?.attempts[0]).toMatchObject({
			status: "FAILED",
			error: "Receiver could not be reached"
		});
	});

	it("rejects a private callback address before connecting", async () => {
		const message = itemMessage("encode:a");
		await seedRequest(REQUEST_ID, {
			items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }],
			destination: { type: "webhook", url: "http://10.0.0.1/hook" }
		});

		await expect(deliverCallback(message, 1)).rejects.toBeInstanceOf(CallbackDeliveryError);

		expect(received).toEqual([]);
		const delivery = await callbackDeliveries().findOne({ _id: callbackEventId(message) });
		expect(delivery?.attempts[0]).toMatchObject({
			status: "FAILED",
			error: "URL host resolves to a private address"
		});
	});

	it("records a skipped delivery when neither the request nor the account has a destination", async () => {
		await accounts().updateOne({ _id: "account-1" }, { $unset: { destination: "" } });
		const message = itemMessage("encode:a");
		await seedRequest(REQUEST_ID, { items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }] });

		await expect(deliverCallback(message, 1)).resolves.toBeUndefined();

		expect(received).toEqual([]);
		const delivery = await callbackDeliveries().findOne({ _id: callbackEventId(message) });
		expect(delivery).toMatchObject({ status: "SKIPPED", attempts: [] });
	});

	it("settles an oversized payload as failed without sending or retrying", async () => {
		const message = itemMessage("encode:a");
		await seedRequest(REQUEST_ID, {
			items: [{ key: "encode:a", kind: "encode", status: "COMPLETE", error: "x".repeat(MAX_PAYLOAD_BYTES) }]
		});

		await expect(deliverCallback(message, 1)).resolves.toBeUndefined();

		expect(received).toEqual([]);
		const delivery = await callbackDeliveries().findOne({ _id: callbackEventId(message) });
		expect(delivery).toMatchObject({
			status: "FAILED",
			attempts: [{ status: "FAILED", error: expect.stringMatching(/above the delivery limit/) }]
		});
	});

	it("keeps one delivery record across redeliveries of the same event", async () => {
		const message = itemMessage("encode:a");
		await seedRequest(REQUEST_ID, { items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }] });

		await deliverCallback(message, 1);
		await deliverCallback(message, 1);

		expect(received).toHaveLength(2);
		expect(received[0]?.headers[WEBHOOK_EVENT_ID_HEADER.toLowerCase()]).toBe(
			received[1]?.headers[WEBHOOK_EVENT_ID_HEADER.toLowerCase()]
		);
		expect(await callbackDeliveries().countDocuments({})).toBe(1);
		const delivery = await callbackDeliveries().findOne({ _id: callbackEventId(message) });
		expect(delivery?.attempts).toHaveLength(2);
	});

	it("marks a pending delivery failed once and ignores repeats", async () => {
		responseStatus = 500;
		const message = itemMessage("encode:a");
		await seedRequest(REQUEST_ID, { items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }] });
		await expect(deliverCallback(message, 5)).rejects.toBeInstanceOf(CallbackDeliveryError);

		await markDeliveryFailed(message);
		await markDeliveryFailed(message);

		const delivery = await callbackDeliveries().findOne({ _id: callbackEventId(message) });
		expect(delivery?.status).toBe("FAILED");
	});

	it.each([
		[1, 30],
		[2, 120],
		[3, 600],
		[4, 1800],
		[5, 7200],
		[9, 7200]
	])("backs off %i receives by %i seconds", (receiveCount, expected) => {
		expect(backoffSec(receiveCount)).toBe(expected);
	});
});
