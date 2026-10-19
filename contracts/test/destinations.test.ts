import { DestinationInputSchema, DestinationSchema, EVENTBRIDGE_BUS_ARN_PATTERN } from "../src";

const validArn = "arn:aws:events:eu-west-1:123456789012:event-bus/customer-bus";

describe("DestinationSchema", () => {
	it("accepts an https webhook URL", () => {
		expect(DestinationSchema.safeParse({ type: "webhook", url: "https://example.com/hook" }).success).toBe(true);
	});

	it.each(["ftp://example.com/hook", "javascript:alert(1)", "not a url"])("rejects webhook URL %s", (url) => {
		expect(DestinationSchema.safeParse({ type: "webhook", url }).success).toBe(false);
	});

	it("accepts a valid EventBridge bus ARN", () => {
		expect(DestinationSchema.safeParse({ type: "eventbridge", eventBusArn: validArn }).success).toBe(true);
	});

	it.each([
		"arn:aws:sqs:eu-west-1:123456789012:queue-name",
		"arn:aws:events:eu-west-1::event-bus/customer-bus",
		"arn:aws:events:eu-west-1:123456789012:rule/customer-rule"
	])("rejects malformed bus ARN %s", (eventBusArn) => {
		expect(EVENTBRIDGE_BUS_ARN_PATTERN.test(eventBusArn)).toBe(false);
		expect(DestinationSchema.safeParse({ type: "eventbridge", eventBusArn }).success).toBe(false);
	});
});

describe("DestinationInputSchema", () => {
	it("accepts destination only", () => {
		const destination = { type: "eventbridge", eventBusArn: validArn };
		expect(DestinationInputSchema.parse({ destination })).toEqual({ destination });
	});

	it("maps callbackUrl to a webhook destination", () => {
		const parsed = DestinationInputSchema.parse({ callbackUrl: "https://example.com/hook" });
		expect(parsed).toEqual({ destination: { type: "webhook", url: "https://example.com/hook" } });
		expect(parsed).not.toHaveProperty("callbackUrl");
	});

	it("rejects destination and callbackUrl together", () => {
		const result = DestinationInputSchema.safeParse({
			destination: { type: "eventbridge", eventBusArn: validArn },
			callbackUrl: "https://example.com/hook"
		});
		expect(result.success).toBe(false);
	});

	it("accepts neither, leaving the requirement to the caller", () => {
		expect(DestinationInputSchema.safeParse({}).success).toBe(true);
	});
});
