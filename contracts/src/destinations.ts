import { z } from "zod";
import { CallbackUrlSchema } from "./api/common";

export const EVENTBRIDGE_BUS_ARN_PATTERN = /^arn:aws:events:[a-z0-9-]+:\d{12}:event-bus\/[A-Za-z0-9._\-\/]+$/;

const WebhookDestinationSchema = z
	.object({
		type: z.literal("webhook"),
		url: z.url({ protocol: /^https?$/ }).describe("URL that receives signed webhook events; http or https only")
	})
	.meta({ id: "WebhookDestination" });

const EventBridgeDestinationSchema = z
	.object({
		type: z.literal("eventbridge"),
		eventBusArn: z
			.string()
			.regex(EVENTBRIDGE_BUS_ARN_PATTERN, "eventBusArn must be an EventBridge event bus ARN")
			.describe("ARN of the customer event bus that receives events")
	})
	.meta({ id: "EventBridgeDestination" });

export const DestinationSchema = z
	.discriminatedUnion("type", [WebhookDestinationSchema, EventBridgeDestinationSchema])
	.describe("Where request events are delivered")
	.meta({ id: "Destination" });
export type Destination = z.infer<typeof DestinationSchema>;

export const DestinationTestErrorSchema = z
	.object({
		code: z.string().describe("Machine-readable error code"),
		message: z.string().describe("Human-readable reason the test failed"),
		hint: z.string().describe("How to fix the destination setup")
	})
	.meta({ id: "DestinationTestError" });
export type DestinationTestError = z.infer<typeof DestinationTestErrorSchema>;

export const DestinationTestResultSchema = z
	.object({
		ok: z.boolean().describe("Whether the test event was delivered"),
		httpStatus: z.int().optional().describe("HTTP status returned by a webhook receiver"),
		error: DestinationTestErrorSchema.optional().describe("Failure details when ok is false")
	})
	.meta({ id: "DestinationTestResult" });
export type DestinationTestResult = z.infer<typeof DestinationTestResultSchema>;

const DestinationInputFieldsSchema = z.object({
	destination: DestinationSchema.optional().describe("Delivery destination; replaces callbackUrl"),
	callbackUrl: CallbackUrlSchema.optional().describe("Shorthand for a webhook destination with this URL")
});

const DestinationPatchFieldsSchema = DestinationInputFieldsSchema.extend({
	destination: DestinationSchema.nullable().optional().describe("Delivery destination; null clears it")
});

function requireOneDestination(value: { destination?: unknown; callbackUrl?: string }, ctx: z.RefinementCtx): void {
	if (value.destination !== undefined && value.callbackUrl !== undefined) {
		ctx.addIssue({
			code: "custom",
			message: "Provide either destination or callbackUrl, not both",
			path: ["destination"]
		});
	}
}

function withWebhookShorthand<T extends { callbackUrl?: string }>({ callbackUrl, ...rest }: T) {
	return callbackUrl === undefined ? rest : { ...rest, destination: { type: "webhook" as const, url: callbackUrl } };
}

export const DestinationInputSchema =
	DestinationInputFieldsSchema.superRefine(requireOneDestination).transform(withWebhookShorthand);

export const DestinationPatchInputSchema =
	DestinationPatchFieldsSchema.superRefine(requireOneDestination).transform(withWebhookShorthand);
