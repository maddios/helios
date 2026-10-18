import { z } from "zod";
import { ProfileTypeSchema } from "./profile";

export const StillItemSchema = z.object({
	key: z.string().describe("Storage key of the still image"),
	timestampSec: z.number().describe("Timestamp of the still in seconds")
});
export type StillItem = z.infer<typeof StillItemSchema>;

export const MediaAssetOutputSchema = z.object({
	profileName: z.string().describe("Name of the profile that produced this output"),
	profileVersion: z.int().describe("Version of the profile that produced this output"),
	kind: ProfileTypeSchema,
	key: z.string().optional().describe("Storage key of the output file"),
	codec: z.string().optional().describe("Output codec"),
	width: z.int().optional().describe("Output width in pixels"),
	height: z.int().optional().describe("Output height in pixels"),
	durationSec: z.number().optional().describe("Output duration in seconds"),
	bitrateK: z.int().optional().describe("Output bitrate in kbps"),
	fileSize: z.int().optional().describe("Output file size in bytes"),
	gated: z.boolean().describe("Whether access to this output is gated"),
	items: z.array(StillItemSchema).optional().describe("Individual stills for stills outputs")
});
export type MediaAssetOutput = z.infer<typeof MediaAssetOutputSchema>;

export const ActiveStillSchema = z.object({
	index: z.int().describe("Index of the selected still"),
	timestampSec: z.number().describe("Timestamp of the selected still in seconds"),
	selectedByUser: z.boolean().describe("Whether a user explicitly selected this still")
});
export type ActiveStill = z.infer<typeof ActiveStillSchema>;
