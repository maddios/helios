import { z } from "zod";
import { CallbackUrlSchema } from "./common";

export const ReencodeRequestSchema = z
	.object({
		refreshPreset: z.boolean().default(false).describe("Re-resolve the preset to its latest version first"),
		requestId: z.uuid().optional().describe("Client idempotency key, stored as clientRequestId"),
		callbackUrl: CallbackUrlSchema.optional().describe("URL notified when the request finishes")
	})
	.meta({ id: "ReencodeRequest" });
export type ReencodeRequest = z.infer<typeof ReencodeRequestSchema>;
