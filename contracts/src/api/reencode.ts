import { z } from "zod";
import { DestinationInputSchema } from "../destinations";

export const ReencodeRequestSchema = z
	.object({
		refreshPreset: z.boolean().default(false).describe("Re-resolve the preset to its latest version first"),
		requestId: z.uuid().optional().describe("Client idempotency key, stored as clientRequestId")
	})
	.and(DestinationInputSchema)
	.meta({ id: "ReencodeRequest" });
export type ReencodeRequest = z.infer<typeof ReencodeRequestSchema>;
