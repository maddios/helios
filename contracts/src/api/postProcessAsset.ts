import { z } from "zod";
import { PostProcessRequestSchema } from "../postProcess";
import { DestinationInputSchema } from "../destinations";

export const AssetPostProcessRequestSchema = z
	.object({
		postProcess: PostProcessRequestSchema.optional().describe("Post-processing to run on the asset"),
		requestId: z.uuid().optional().describe("Client idempotency key, stored as clientRequestId")
	})
	.and(DestinationInputSchema)
	.meta({ id: "AssetPostProcessRequest" });
export type AssetPostProcessRequest = z.infer<typeof AssetPostProcessRequestSchema>;
