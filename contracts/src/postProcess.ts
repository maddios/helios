import { z } from "zod";

export const TranscribeOptionsSchema = z.object({
	language: z.string().optional().describe("ISO language hint for transcription"),
	translateToEnglish: z.boolean().optional().describe("Translate the transcript to English")
});
export type TranscribeOptions = z.infer<typeof TranscribeOptionsSchema>;

export const PostProcessRequestSchema = z.object({
	transcribe: z
		.union([z.boolean(), TranscribeOptionsSchema])
		.optional()
		.describe("Enable transcription or pass transcription options"),
	sceneDetection: z.boolean().optional().describe("Enable scene detection and analysis")
});
export type PostProcessRequest = z.infer<typeof PostProcessRequestSchema>;

export const PostProcessDefaultsSchema = z.object({
	transcribe: z.boolean().describe("Transcribe audio by default"),
	sceneDetection: z.boolean().describe("Run scene detection by default")
});
export type PostProcessDefaults = z.infer<typeof PostProcessDefaultsSchema>;

export const ResolvedPostProcessSchema = z.object({
	transcribe: z
		.union([
			z.literal(false),
			z.object({
				language: z.string().optional().describe("ISO language hint for transcription"),
				translateToEnglish: z.boolean().describe("Translate the transcript to English")
			})
		])
		.describe("Transcription options, or false when transcription is off"),
	sceneDetection: z.boolean().describe("Whether scene detection runs")
});
export type ResolvedPostProcess = z.infer<typeof ResolvedPostProcessSchema>;
