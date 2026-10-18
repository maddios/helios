import { z } from "zod";
import { PostProcessRequestSchema } from "../postProcess";
import { CallbackUrlSchema } from "./common";

export const AssetPostProcessRequestSchema = z
	.object({
		postProcess: PostProcessRequestSchema.optional().describe("Post-processing to run on the asset"),
		requestId: z.uuid().optional().describe("Client idempotency key, stored as clientRequestId"),
		callbackUrl: CallbackUrlSchema.optional().describe("URL notified when the request finishes")
	})
	.meta({ id: "AssetPostProcessRequest" });
export type AssetPostProcessRequest = z.infer<typeof AssetPostProcessRequestSchema>;
