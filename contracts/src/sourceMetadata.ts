import { z } from "zod";

export const SourceTypeSchema = z.enum(["video", "image"]).describe("Kind of source media");
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const VideoSourceMetadataSchema = z.object({
	type: z.literal("video"),
	sizeBytes: z.int().describe("Source file size in bytes"),
	width: z.int().describe("Display width in pixels, after rotation"),
	height: z.int().describe("Display height in pixels, after rotation"),
	durationSec: z.number().positive().describe("Source duration in seconds"),
	fps: z.number().positive().describe("Source frame rate"),
	videoCodec: z.string().describe("Source video codec name"),
	audioCodec: z.string().optional().describe("Source audio codec name"),
	hasAudio: z.boolean().describe("Whether the source contains an audio stream"),
	probe: z.unknown().optional().describe("Raw ffprobe JSON output")
});
export type VideoSourceMetadata = z.infer<typeof VideoSourceMetadataSchema>;

export const ImageSourceMetadataSchema = z.object({
	type: z.literal("image"),
	sizeBytes: z.int().describe("Source file size in bytes"),
	width: z.int().describe("Display width in pixels, after rotation"),
	height: z.int().describe("Display height in pixels, after rotation"),
	hasAudio: z.literal(false).describe("Images never contain an audio stream"),
	probe: z.unknown().optional().describe("Raw ffprobe JSON output")
});
export type ImageSourceMetadata = z.infer<typeof ImageSourceMetadataSchema>;

export const SourceMetadataSchema = z.discriminatedUnion("type", [
	VideoSourceMetadataSchema,
	ImageSourceMetadataSchema
]);
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>;
