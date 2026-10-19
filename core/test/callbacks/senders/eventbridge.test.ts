import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { mockClient } from "aws-sdk-client-mock";
import { sendEventBridge } from "../../../src/callbacks/senders/eventbridge";
import type { Envelope } from "../../../src/callbacks/senders/types";

const eventBridgeMock = mockClient(EventBridgeClient);
const EVENT_BUS_ARN = "arn:aws:events:us-east-2:123456789012:event-bus/customer-bus";
const ACCOUNT_ID = "acct-1";
const now = new Date("2026-10-18T10:00:00.000Z");
const envelope: Envelope = {
	id: "evt-1",
	event: "request.completed",
	createdAt: now.toISOString(),
	sequence: 3,
	data: { requestId: "req-1" }
};

describe("sendEventBridge", () => {
	beforeEach(() => {
		process.env = { ...process.env, CALLBACK_TIMEOUT_SEC: "10" };
		eventBridgeMock.reset();
	});

	it("puts one entry carrying the envelope as the detail", async () => {
		eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: "e-1" }] });

		await expect(sendEventBridge(EVENT_BUS_ARN, envelope, ACCOUNT_ID, now)).resolves.toEqual({ status: "DELIVERED" });

		expect(eventBridgeMock.commandCalls(PutEventsCommand)[0]?.args[0].input).toEqual({
			Entries: [
				{
					EventBusName: EVENT_BUS_ARN,
					Source: "helios.acct-1",
					DetailType: "request.completed",
					Detail: JSON.stringify(envelope),
					Time: now
				}
			]
		});
	});

	it("reports a failed entry as a failed attempt", async () => {
		eventBridgeMock.on(PutEventsCommand).resolves({
			FailedEntryCount: 1,
			Entries: [{ ErrorCode: "InternalFailure", ErrorMessage: "boom" }]
		});

		await expect(sendEventBridge(EVENT_BUS_ARN, envelope, ACCOUNT_ID, now)).resolves.toEqual({
			status: "FAILED",
			error: "EventBridge rejected the event entry"
		});
	});

	it("reports a thrown SDK error with a fixed message and no raw AWS text", async () => {
		eventBridgeMock
			.on(PutEventsCommand)
			.rejects(
				Object.assign(new Error("arn:aws:iam::123456789012:role/secret not allowed"), { name: "AccessDeniedException" })
			);

		await expect(sendEventBridge(EVENT_BUS_ARN, envelope, ACCOUNT_ID, now)).resolves.toEqual({
			status: "FAILED",
			error: "EventBridge denied access to the bus"
		});
	});
});
