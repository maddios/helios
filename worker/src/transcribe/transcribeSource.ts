import { stat } from "node:fs/promises";
import path from "node:path";
import type { TranscriptSegment } from "@helios/contracts";
import { objectStore, sourceObjectLocation } from "@helios/core";
import { config } from "../config";
import { probeOutput } from "../ffmpeg/probe";
import type { HandlerContext } from "../handlers/types";
import { extractAudio } from "./extractAudio";
import { planChunks } from "./planChunks";
import { transcribeChunks } from "./transcribeChunks";

export interface TranscribedSource {
	language: string;
	durationSec: number;
	segments: TranscriptSegment[];
}

export async function transcribeSource(ctx: HandlerContext, language?: string): Promise<TranscribedSource> {
	const cfg = config();
	const { bucket, key } = sourceObjectLocation(ctx.asset);
	const sourceUrl = await objectStore().presignGet(bucket, key, cfg.SOURCE_URL_TTL_SEC);
	const audioPath = path.join(ctx.workDir, "audio.mp3");
	await extractAudio(sourceUrl, audioPath, ctx.signal);
	const { size } = await stat(audioPath);
	const { durationSec } = await probeOutput(audioPath);
	if (durationSec === undefined) {
		throw new Error(`Extracted audio of asset ${ctx.asset._id} has no duration`);
	}
	const plans = planChunks(durationSec, size, {
		maxUploadBytes: cfg.TRANSCRIBE_MAX_UPLOAD_BYTES,
		chunkSec: cfg.TRANSCRIBE_CHUNK_SEC,
		overlapSec: cfg.TRANSCRIBE_OVERLAP_SEC
	});
	const transcribed = await transcribeChunks(audioPath, plans, {
		workDir: ctx.workDir,
		language,
		meter: ctx.meter,
		signal: ctx.signal
	});
	return { ...transcribed, durationSec };
}
