import { z } from "zod";
import { DestinationSchema, DestinationTestResultSchema, EVENTBRIDGE_BUS_ARN_PATTERN } from "../destinations";

export const DestinationTestRequestSchema = z
	.object({
		destination: DestinationSchema.optional().describe("Destination to test; defaults to the account destination")
	})
	.meta({ id: "DestinationTestRequest" });
export type DestinationTestRequest = z.infer<typeof DestinationTestRequestSchema>;

export const DestinationTestResponseSchema = DestinationTestResultSchema;

export const EventBridgePolicyQuerySchema = z
	.object({
		eventBusArn: z
			.string()
			.regex(EVENTBRIDGE_BUS_ARN_PATTERN, "eventBusArn must be an EventBridge event bus ARN")
			.describe("ARN of the customer event bus")
	})
	.meta({ id: "EventBridgePolicyQuery" });
export type EventBridgePolicyQuery = z.infer<typeof EventBridgePolicyQuerySchema>;

export const EventBridgePolicyResponseSchema = z
	.object({
		policy: z
			.object({
				Version: z.literal("2012-10-17"),
				Statement: z.array(
					z.object({
						Sid: z.string(),
						Effect: z.literal("Allow"),
						Principal: z.object({ AWS: z.string() }),
						Action: z.literal("events:PutEvents"),
						Resource: z.string(),
						Condition: z.object({ StringEquals: z.object({ "events:source": z.string() }) })
					})
				)
			})
			.describe("Resource policy to attach to the bus, with Helios's account and the bus ARN filled in"),
		command: z.string().describe("AWS CLI command that attaches the policy; --policy replaces the whole bus policy")
	})
	.meta({ id: "EventBridgePolicyResponse" });
export type EventBridgePolicyResponse = z.infer<typeof EventBridgePolicyResponseSchema>;

export const AccountDestinationRequestSchema = z
	.object({
		destination: DestinationSchema.nullable().describe("Default delivery destination; null clears it")
	})
	.meta({ id: "AccountDestinationRequest" });
export type AccountDestinationRequest = z.infer<typeof AccountDestinationRequestSchema>;

export const AccountDestinationResponseSchema = z
	.object({
		destination: DestinationSchema.nullable().describe("Default delivery destination, or null when none is set")
	})
	.meta({ id: "AccountDestinationResponse" });
export type AccountDestinationResponse = z.infer<typeof AccountDestinationResponseSchema>;
