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
