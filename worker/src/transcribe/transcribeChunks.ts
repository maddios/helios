import type { TranscriptSegment } from "@helios/contracts";
import { transcribeAudio, type TranscribeAudioResult, type UsageMeter } from "@helios/core";
import path from "node:path";
import { cutChunk } from "./cutChunk";
import { mergeSegments } from "./mergeSegments";
import type { ChunkPlan } from "./planChunks";

export interface TranscribedAudio {
	language: string;
	segments: TranscriptSegment[];
}

export interface TranscribeChunksOptions {
	workDir: string;
	language?: string;
	meter: UsageMeter;
	signal: AbortSignal;
}

export async function transcribeChunks(
	audioPath: string,
	plans: ChunkPlan[],
	{ workDir, language, meter, signal }: TranscribeChunksOptions
): Promise<TranscribedAudio> {
	const transcribed: { plan: ChunkPlan; audio: TranscribeAudioResult }[] = [];
	let languageHint = language;
	for (const plan of plans) {
		signal.throwIfAborted();
		const chunkPath = path.join(workDir, `chunk-${plan.index}.mp3`);
		await cutChunk(audioPath, plan, chunkPath, signal);
		const audio = await transcribeAudio({
			filePath: chunkPath,
			...(languageHint !== undefined && { language: languageHint }),
			meter,
			signal
		});
		languageHint ??= audio.language;
		transcribed.push({ plan, audio });
	}
	const [first] = transcribed;
	return {
		language: first.audio.language,
		segments: mergeSegments(
			transcribed.map(({ plan, audio }) => ({
				keepFrom: plan.keepFrom,
				keepUntil: plan.keepUntil,
				offset: plan.start,
				segments: audio.segments
			}))
		)
	};
}
