import { z } from "zod";
import { SourceTypeSchema } from "./sourceMetadata";

export const ProfileTypeSchema = z.enum(["video", "stills", "audio", "image"]).describe("Encoding profile type");
export type ProfileType = z.infer<typeof ProfileTypeSchema>;

const SampleRateSchema = z
	.union([z.literal(22050), z.literal(44100), z.literal(48000)])
	.describe("Audio sample rate in Hz");

const ProfileCommonSchema = z.object({
	name: z.string().describe("Profile name, unique within its preset"),
	version: z.int().min(1).describe("Profile version"),
	priority: z.int().describe("Scheduling priority of the profile's item"),
	isDefault: z.boolean().describe("Whether this profile is the default for its source types"),
	sourceTypes: z.array(SourceTypeSchema).min(1).describe("Source types this profile applies to"),
	children: z.array(z.string()).describe("Names of child profiles run inside this profile's item"),
	output: z.string().describe("Output filename template, e.g. {id}.mp4")
});

export const VideoProfileSchema = ProfileCommonSchema.extend({
	type: z.literal("video"),
	params: z.object({
		codec: z.enum(["h264"]).describe("Video codec"),
		height: z.int().positive().max(4320).describe("Output height in pixels"),
		videoBitrateK: z.int().positive().max(100000).describe("Video bitrate in kbps"),
		audioBitrateK: z.int().positive().max(512).describe("Audio bitrate in kbps"),
		audioSampleRate: SampleRateSchema,
		rateControl: z.enum(["vbr", "cbr"]).describe("Bitrate rate control mode"),
		x264Preset: z
			.enum(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"])
			.describe("x264 encoder preset"),
		x264Profile: z.enum(["baseline", "main", "high"]).describe("x264 H.264 profile"),
		x264Opts: z.string().describe("Extra x264 options"),
		deinterlace: z.boolean().describe("Whether to deinterlace the source"),
		fps: z.int().positive().max(120).describe("Output frame rate"),
		gopSeconds: z.number().positive().describe("Keyframe interval in seconds"),
		faststart: z.boolean().describe("Whether to move MP4 metadata to the start of the file")
	})
});
export type VideoProfile = z.infer<typeof VideoProfileSchema>;

export const StillsProfileSchema = ProfileCommonSchema.extend({
	type: z.literal("stills"),
	params: z.object({
		fps: z
			.string()
			.regex(/^\d+(\/\d+)?$/)
			.describe("Still extraction rate as an ffmpeg fraction, e.g. 1/3"),
		maxCount: z.int().positive().optional().describe("Maximum number of stills to extract")
	})
});
export type StillsProfile = z.infer<typeof StillsProfileSchema>;

export const AudioProfileSchema = ProfileCommonSchema.extend({
	type: z.literal("audio"),
	params: z.object({
		codec: z.enum(["mp3"]).describe("Audio codec"),
		bitrateK: z.int().positive().max(320).describe("Audio bitrate in kbps"),
		sampleRate: SampleRateSchema
	})
});
export type AudioProfile = z.infer<typeof AudioProfileSchema>;

export const ImageProfileSchema = ProfileCommonSchema.extend({
	type: z.literal("image"),
	params: z.object({
		format: z.enum(["jpg", "png", "webp"]).describe("Image format"),
		quality: z.int().min(1).max(100).describe("Image quality from 1 to 100")
	})
});
export type ImageProfile = z.infer<typeof ImageProfileSchema>;

export const EncodingProfileSchema = z.discriminatedUnion("type", [
	VideoProfileSchema,
	StillsProfileSchema,
	AudioProfileSchema,
	ImageProfileSchema
]);
export type EncodingProfile = z.infer<typeof EncodingProfileSchema>;
