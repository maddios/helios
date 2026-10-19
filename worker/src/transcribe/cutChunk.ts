import { runFfmpeg } from "../ffmpeg/run";
import type { ChunkPlan } from "./planChunks";

export function cutChunkArgs(inputPath: string, chunk: ChunkPlan, outPath: string): string[] {
	return [
		"-y",
		"-nostdin",
		"-ss",
		String(chunk.start),
		"-t",
		String(chunk.end - chunk.start),
		"-i",
		inputPath,
		"-map",
		"0:a:0",
		"-c",
		"copy",
		"-f",
		"mp3",
		outPath
	];
}

export function cutChunk(inputPath: string, chunk: ChunkPlan, outPath: string, signal: AbortSignal): Promise<void> {
	return runFfmpeg(cutChunkArgs(inputPath, chunk, outPath), { signal });
}
