import { inputArgs } from "../ffmpeg/args";
import { runFfmpeg } from "../ffmpeg/run";

export function audioExtractArgs(sourceUrl: string, outPath: string): string[] {
	return [
		...inputArgs(sourceUrl),
		"-vn",
		"-ac",
		"1",
		"-ar",
		"16000",
		"-c:a",
		"libmp3lame",
		"-b:a",
		"32k",
		"-f",
		"mp3",
		outPath
	];
}

export function extractAudio(sourceUrl: string, outPath: string, signal: AbortSignal): Promise<void> {
	return runFfmpeg(audioExtractArgs(sourceUrl, outPath), { signal });
}
