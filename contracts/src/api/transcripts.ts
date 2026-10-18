import { z } from "zod";
import { TranscriptSchema } from "../transcript";

export const AssetTranscriptsResponseSchema = z
	.object({
		transcripts: z.array(TranscriptSchema).describe("Transcripts produced for the asset")
	})
	.meta({ id: "AssetTranscripts" });
export type AssetTranscriptsResponse = z.infer<typeof AssetTranscriptsResponseSchema>;
