import { z } from "zod";

export const MAX_TRANSLATIONS = 20;

export const TranscribeOptionsSchema = z
	.object({
		language: z
			.string()
			.optional()
			.describe(
				"ISO language code of the spoken language. Omit to detect it. A different code replaces the stored native transcript and regenerates every existing translation"
			),
		translations: z
			.array(z.string().min(1))
			.max(MAX_TRANSLATIONS)
			.optional()
			.describe(
				"ISO language codes to translate the native transcript into, up to 20. Duplicates are ignored. Requests are additive: stored languages are kept and missing ones are added"
			),
		english: z
			.boolean()
			.optional()
			.describe(
				"Add an English track when the spoken language is not English. Defaults to true on every request, so a later request re-adds it unless false. false does not remove an existing English track, and a retranscribe still regenerates it. Ignored for English sources"
			),
		retranscribe: z
			.boolean()
			.optional()
			.describe(
				"Transcribe the audio again instead of reusing the stored native transcript, and regenerate every existing translation. Defaults to false"
			)
	})
	.meta({ example: { language: "pt", english: false, translations: ["es"] } });
export type TranscribeOptions = z.infer<typeof TranscribeOptionsSchema>;

export const PostProcessRequestSchema = z
	.object({
		transcribe: z
			.union([z.boolean(), TranscribeOptionsSchema])
			.optional()
			.describe("Enable transcription or pass transcription options"),
		sceneDetection: z.boolean().optional().describe("Enable scene detection and analysis")
	})
	.meta({ example: { transcribe: { translations: ["es", "fr"] } } });
export type PostProcessRequest = z.infer<typeof PostProcessRequestSchema>;

export const PostProcessDefaultsSchema = z.object({
	transcribe: z.boolean().describe("Transcribe audio by default"),
	sceneDetection: z.boolean().describe("Run scene detection by default")
});
export type PostProcessDefaults = z.infer<typeof PostProcessDefaultsSchema>;

export const ResolvedTranscribeSchema = z.object({
	language: z.string().optional().describe("ISO language code of the spoken language, when given"),
	translations: z.array(z.string()).describe("Requested translation languages, deduplicated"),
	english: z.boolean().describe("Whether an English track is added for non-English sources"),
	retranscribe: z.boolean().describe("Whether the audio is transcribed again")
});
export type ResolvedTranscribe = z.infer<typeof ResolvedTranscribeSchema>;

export const ResolvedPostProcessSchema = z.object({
	transcribe: z
		.union([z.literal(false), ResolvedTranscribeSchema])
		.describe("Resolved transcription options, or false"),
	sceneDetection: z.boolean().describe("Whether scene detection runs")
});
export type ResolvedPostProcess = z.infer<typeof ResolvedPostProcessSchema>;
