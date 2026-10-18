import { z } from "zod";

export const HealthResponseSchema = z
	.object({
		status: z.literal("ok").describe("Service health status")
	})
	.meta({ id: "Health" });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadyResponseSchema = z
	.object({
		status: z.literal("ready").describe("Service readiness status")
	})
	.meta({ id: "Ready" });
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
