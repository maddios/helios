import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { mockClient } from "aws-sdk-client-mock";
import { WEBHOOK_EVENT_HEADER } from "@helios/contracts";
import { ensureIndexes } from "../../src/models";
import { resetCallbacksConfigForTests, sendTestEvent } from "../../src/callbacks";
import { resetConfigForTests } from "../../src/config";
import { resetDb, startMongo, stopMongo } from "../helpers/mongo";
import { seedAccount } from "../helpers/callbackFixtures";

const eventBridgeMock = mockClient(EventBridgeClient);
const EVENT_BUS_ARN = "arn:aws:events:us-east-2:123456789012:event-bus/customer-bus";

describe("sendTestEvent", () => {
	const original = process.env;
	let server: Server;
	let base: string;
	let received: IncomingHttpHeaders[];
	let responseStatus: number;

	beforeAll(async () => {
		await startMongo();
		server = createServer((req, res) => {
			received.push(req.headers);
			req.resume().on("end", () => res.writeHead(responseStatus).end());
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
		await seedAccount();
	});

	afterEach(() => {
		process.env = original;
		resetConfigForTests();
		resetCallbacksConfigForTests();
	});

	it("reports a non-https webhook as blocked outside local stage", async () => {
		process.env = { ...process.env, STAGE: "prod", SSRF_ALLOWED_HOSTS: "" };
		resetConfigForTests();

		await expect(sendTestEvent({ type: "webhook", url: `${base}/hook` }, "account-1")).resolves.toMatchObject({
			ok: false,
			error: { code: "webhook_address_blocked", message: "Webhook URL must use https" }
		});
	});

	it("sends a signed helios.test event to a webhook", async () => {
		await expect(sendTestEvent({ type: "webhook", url: `${base}/hook` }, "account-1")).resolves.toEqual({
			ok: true,
			httpStatus: 200
		});

		expect(received[0]?.[WEBHOOK_EVENT_HEADER.toLowerCase()]).toBe("helios.test");
		expect(received[0]?.["helios-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
	});

	it("reports a webhook that answers non-2xx", async () => {
		responseStatus = 500;

		await expect(sendTestEvent({ type: "webhook", url: `${base}/hook` }, "account-1")).resolves.toEqual({
			ok: false,
			httpStatus: 500,
			error: {
				code: "webhook_failed",
				message: "Receiver responded with status 500",
				hint: "Your endpoint answered HTTP 500; check it accepts POST and returns 2xx."
			}
		});
	});

	it("reports a webhook address that resolves to a private range as blocked", async () => {
		const result = await sendTestEvent({ type: "webhook", url: "http://10.0.0.1/hook" }, "account-1");

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "webhook_address_blocked",
				message: "URL host resolves to a private address",
				hint: "use a public https URL on port 443 (or 80 outside production) that does not resolve to a private address"
			}
		});
	});

	it("reports a webhook that cannot be reached", async () => {
		const result = await sendTestEvent({ type: "webhook", url: "http://127.0.0.1:1/hook" }, "account-1");

		expect(result).toMatchObject({ ok: false, error: { code: "webhook_unreachable" } });
	});

	it("sends a test event to an EventBridge bus", async () => {
		eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: "e-1" }] });

		await expect(sendTestEvent({ type: "eventbridge", eventBusArn: EVENT_BUS_ARN }, "account-1")).resolves.toEqual({
			ok: true
		});
		expect(eventBridgeMock.commandCalls(PutEventsCommand)[0]?.args[0].input.Entries?.[0]).toMatchObject({
			DetailType: "helios.test",
			EventBusName: EVENT_BUS_ARN
		});
	});

	it("explains an EventBridge access denial with the policy hint", async () => {
		eventBridgeMock
			.on(PutEventsCommand)
			.rejects(Object.assign(new Error("User is not authorized"), { name: "AccessDeniedException" }));

		await expect(sendTestEvent({ type: "eventbridge", eventBusArn: EVENT_BUS_ARN }, "account-1")).resolves.toEqual({
			ok: false,
			error: {
				code: "eventbridge_access_denied",
				message: "EventBridge denied access to the bus",
				hint: "the bus resource policy doesn't allow Helios to PutEvents; attach the policy from GET /destinations/eventbridge/policy (Helios account 111111111111)"
			}
		});
	});

	it("explains a missing EventBridge bus", async () => {
		eventBridgeMock
			.on(PutEventsCommand)
			.rejects(Object.assign(new Error("Bus not found"), { name: "ResourceNotFoundException" }));

		await expect(sendTestEvent({ type: "eventbridge", eventBusArn: EVENT_BUS_ARN }, "account-1")).resolves.toEqual({
			ok: false,
			error: {
				code: "eventbridge_bus_not_found",
				message: "EventBridge bus was not found",
				hint: "check the bus name and the region in the ARN"
			}
		});
	});

	it("reports a rejected EventBridge entry", async () => {
		eventBridgeMock.on(PutEventsCommand).resolves({
			FailedEntryCount: 1,
			Entries: [{ ErrorCode: "InternalFailure", ErrorMessage: "boom" }]
		});

		await expect(
			sendTestEvent({ type: "eventbridge", eventBusArn: EVENT_BUS_ARN }, "account-1")
		).resolves.toMatchObject({
			ok: false,
			error: { code: "eventbridge_entry_failed", message: "EventBridge rejected the event entry" }
		});
	});
});
