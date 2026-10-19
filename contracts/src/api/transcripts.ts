import { z } from "zod";
import { TranscriptViewSchema } from "../transcript";

export const AssetTranscriptsResponseSchema = z
	.object({
		transcripts: z.array(TranscriptViewSchema).describe("Transcripts produced for the asset, with CDN urls")
	})
	.meta({ id: "AssetTranscripts" });
export type AssetTranscriptsResponse = z.infer<typeof AssetTranscriptsResponseSchema>;
