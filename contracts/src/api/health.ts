import { z } from "zod";

export const HealthResponseSchema = z
	.object({
		status: z.literal("ok").describe("Service health status")
	})
	.meta({ id: "Health" });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
