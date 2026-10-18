import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { EncodingProfile, StillsProfile, VideoSourceMetadata } from "@helios/contracts";
import { objectStore } from "@helios/core";
import { config } from "../../config";
import { buildCommand, type FfmpegOutput } from "../../ffmpeg/args";
import { runFfmpeg } from "../../ffmpeg/run";
import { localOutputPath } from "../outputPath";
import { storeOutputs, type StoredOutputs } from "../storage";
import type { HandlerContext } from "../types";

interface PlannedOutput {
	profile: EncodingProfile;
	localPath: string;
	ffmpeg: FfmpegOutput;
}

function planOutput(profile: EncodingProfile, ctx: HandlerContext, source: VideoSourceMetadata): PlannedOutput {
	const localPath = localOutputPath(ctx.workDir, profile.output, ctx.asset._id);
	if (profile.type === "video") {
		return { profile, localPath, ffmpeg: { type: "video", profile, source, outPath: localPath } };
	}
	if (profile.type === "audio") {
		return { profile, localPath, ffmpeg: { type: "audio", profile, outPath: localPath } };
	}
	if (profile.type === "stills") {
		return { profile, localPath, ffmpeg: { type: "stills", profile, outPath: localPath } };
	}
	throw new Error(`Profile ${profile.name} of type ${profile.type} cannot encode a video source`);
}

export async function encodeVideo(
	ctx: HandlerContext,
	source: VideoSourceMetadata,
	profile: EncodingProfile,
	children: StillsProfile[]
): Promise<StoredOutputs> {
	const planned = [profile, ...children].map((output) => planOutput(output, ctx, source));
	for (const output of planned) {
		await mkdir(path.dirname(output.localPath), { recursive: true });
	}
	const { bucket, key } = ctx.asset.source;
	const input = await objectStore().presignGet(bucket, key, config().SOURCE_URL_TTL_SEC);
	await runFfmpeg(
		buildCommand(
			input,
			planned.map((output) => output.ffmpeg)
		),
		{ durationSec: source.durationSec, onProgress: ctx.reportProgress, signal: ctx.signal }
	);
	return storeOutputs(ctx, planned);
}
