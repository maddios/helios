import { z } from "zod";
import type { SourceMetadata } from "@helios/contracts";
import { UnprocessableSourceError } from "../ssrf";

const StreamSchema = z.object({
	codec_type: z.string(),
	codec_name: z.string().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	avg_frame_rate: z.string().optional(),
	duration: z.string().optional(),
	tags: z.record(z.string(), z.string()).optional(),
	side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional()
});

const FormatSchema = z.object({
	format_name: z.string().optional(),
	duration: z.string().optional(),
	size: z.string().optional()
});

const ProbeSchema = z.object({
	streams: z.array(StreamSchema),
	format: FormatSchema
});

const IMAGE_CODECS = new Set(["png", "mjpeg", "webp", "gif"]);
const IMAGE_FORMATS = new Set(["image2", "png_pipe", "webp_pipe", "gif", "jpeg_pipe", "image2pipe"]);

type Stream = z.infer<typeof StreamSchema>;
type Format = z.infer<typeof FormatSchema>;

export function mapProbeOutput(raw: unknown): SourceMetadata {
	const parsed = ProbeSchema.safeParse(raw);
	if (!parsed.success) {
		throw new UnprocessableSourceError("ffprobe output is not recognized");
	}
	const { streams, format } = parsed.data;
	const video = streams.find((stream) => stream.codec_type === "video");
	if (video === undefined) {
		throw new UnprocessableSourceError("Source has no video or image stream");
	}
	const sizeBytes = parseSize(format.size);
	const durationSec = parseNumber(format.duration) ?? parseNumber(video.duration);
	const { width, height } = displaySize(video);
	if (isImage(video, format, durationSec)) {
		return { type: "image", sizeBytes, width, height, hasAudio: false, probe: withoutFilename(raw) };
	}
	if (durationSec === undefined || durationSec <= 0) {
		throw new UnprocessableSourceError("Source has no duration");
	}
	const audio = streams.find((stream) => stream.codec_type === "audio");
	return {
		type: "video",
		sizeBytes,
		width,
		height,
		durationSec,
		fps: parseFrameRate(video.avg_frame_rate),
		videoCodec: requireCodec(video),
		...(audio?.codec_name !== undefined && { audioCodec: audio.codec_name }),
		hasAudio: audio !== undefined,
		probe: withoutFilename(raw)
	};
}

function withoutFilename(raw: unknown): unknown {
	const { format, ...rest } = raw as { format: Record<string, unknown> };
	const { filename: _filename, ...remaining } = format;
	return { ...rest, format: remaining };
}

function isImage(video: Stream, format: Format, durationSec: number | undefined): boolean {
	const singleFrame = durationSec === undefined || durationSec <= 0 || IMAGE_FORMATS.has(format.format_name ?? "");
	return IMAGE_CODECS.has(video.codec_name ?? "") && singleFrame;
}

function displaySize(video: Stream): { width: number; height: number } {
	if (video.width === undefined || video.height === undefined) {
		throw new UnprocessableSourceError("Video stream has no dimensions");
	}
	const rotation =
		video.side_data_list?.find((data) => data.rotation !== undefined)?.rotation ?? parseNumber(video.tags?.rotate) ?? 0;
	const swapped = Math.abs(rotation) % 180 === 90;
	return swapped ? { width: video.height, height: video.width } : { width: video.width, height: video.height };
}

function parseFrameRate(value: string | undefined): number {
	const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
	if (match === null || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
		throw new UnprocessableSourceError("Video stream has no usable frame rate");
	}
	return Number(match[1]) / Number(match[2]);
}

function parseSize(size: string | undefined): number {
	if (size === undefined || !/^\d+$/.test(size)) {
		throw new UnprocessableSourceError("ffprobe did not report the source size");
	}
	return Number(size);
}

function parseNumber(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function requireCodec(video: Stream): string {
	if (video.codec_name === undefined) {
		throw new UnprocessableSourceError("Video stream has no codec name");
	}
	return video.codec_name;
}
