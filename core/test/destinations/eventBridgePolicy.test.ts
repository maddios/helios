import { eventBridgePolicy, InvalidEventBusArnError } from "../../src/destinations";

const EVENT_BUS_ARN = "arn:aws:events:us-east-2:123456789012:event-bus/customer-bus";

describe("eventBridgePolicy", () => {
	it("returns the resource policy scoped to the account source and the put-permission command", () => {
		expect(eventBridgePolicy(EVENT_BUS_ARN, "acct-1")).toEqual({
			policy: {
				Version: "2012-10-17",
				Statement: [
					{
						Sid: "helios-acct-1",
						Effect: "Allow",
						Principal: { AWS: "arn:aws:iam::111111111111:root" },
						Action: "events:PutEvents",
						Resource: EVENT_BUS_ARN,
						Condition: { StringEquals: { "events:source": "helios.acct-1" } }
					}
				]
			},
			command: "aws events put-permission --region us-east-2 --event-bus-name customer-bus --policy file://policy.json"
		});
	});

	it("rejects an ARN that is not an event bus ARN", () => {
		expect(() => eventBridgePolicy("arn:aws:sqs:us-east-2:123456789012:queue", "acct-1")).toThrow(
			InvalidEventBusArnError
		);
	});

	it("rejects a bus in Helios's own account", () => {
		expect(() => eventBridgePolicy("arn:aws:events:us-east-2:111111111111:event-bus/own", "acct-1")).toThrow(
			InvalidEventBusArnError
		);
	});
});
