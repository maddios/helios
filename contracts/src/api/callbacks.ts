import { z } from "zod";

export const CallbackAttemptSchema = z.object({
	at: z.iso.datetime().describe("When the delivery attempt happened"),
	status: z.enum(["DELIVERED", "FAILED"]).describe("Outcome of the attempt"),
	httpStatus: z.int().optional().describe("HTTP status returned by the receiver"),
	error: z.string().optional().describe("Error message when the attempt failed")
});
export type CallbackAttempt = z.infer<typeof CallbackAttemptSchema>;

export const CallbackDeliveryViewSchema = z
	.object({
		id: z.string().describe("Delivery id"),
		requestId: z.string().describe("Id of the request that triggered the callback"),
		event: z.string().describe("Event name sent to the receiver"),
		attempts: z.array(CallbackAttemptSchema).describe("Delivery attempts in order"),
		deliveredAt: z.iso.datetime().optional().describe("When the callback was delivered"),
		createdAt: z.iso.datetime().describe("When the delivery was created")
	})
	.meta({ id: "CallbackDelivery" });
export type CallbackDeliveryView = z.infer<typeof CallbackDeliveryViewSchema>;

export const CallbackDeliveryListResponseSchema = z
	.object({
		deliveries: z.array(CallbackDeliveryViewSchema).describe("Callback deliveries for the request")
	})
	.meta({ id: "CallbackDeliveryList" });
export type CallbackDeliveryListResponse = z.infer<typeof CallbackDeliveryListResponseSchema>;

export const RedeliverResponseSchema = z
	.object({
		requestId: z.string().describe("Id of the request whose callback was redelivered")
	})
	.meta({ id: "RedeliverResponse" });
export type RedeliverResponse = z.infer<typeof RedeliverResponseSchema>;
