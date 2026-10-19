import { z } from "zod";

export const TranscriptSegmentSchema = z.object({
	start: z.number().describe("Segment start in seconds"),
	end: z.number().describe("Segment end in seconds"),
	text: z.string().describe("Segment text")
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptSchema = z.object({
	language: z.string().describe("Detected or requested language"),
	isTranslation: z.boolean().describe("Whether the text is a translation"),
	segments: z.array(TranscriptSegmentSchema).describe("Timed transcript segments"),
	text: z.string().describe("Full transcript text"),
	durationSec: z.number().describe("Audio duration in seconds"),
	model: z.string().describe("Transcription model identifier")
});
export type Transcript = z.infer<typeof TranscriptSchema>;

export const TranscriptFilesSchema = z.object({
	srt: z.string().describe("Location of the SRT caption file"),
	vtt: z.string().describe("Location of the WebVTT caption file"),
	txt: z.string().describe("Location of the plain text file")
});
export type TranscriptFiles = z.infer<typeof TranscriptFilesSchema>;

export const TranscriptViewSchema = TranscriptSchema.extend({
	urls: TranscriptFilesSchema.describe("CDN urls of the transcript files")
});
export type TranscriptView = z.infer<typeof TranscriptViewSchema>;

export const TranscriptOutputSchema = z.object({
	language: z.string().describe("Language of the stored transcript"),
	isTranslation: z.boolean().describe("Whether the stored transcript is a translation"),
	revision: z.int().describe("Revision of the stored transcript, bumped on each write"),
	keys: TranscriptFilesSchema.describe("Storage keys of the transcript files")
});
export type TranscriptOutput = z.infer<typeof TranscriptOutputSchema>;
