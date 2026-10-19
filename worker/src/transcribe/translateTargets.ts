import type { TranscriptSegment } from "@helios/contracts";
import type { StoreTranscriptInput, UsageMeter } from "@helios/core";
import { forEachLimit } from "./forEachLimit";
import { translateSegments } from "./translateSegments";

export interface SpokenTrack {
	language: string;
	segments: TranscriptSegment[];
	durationSec: number;
}

export type TrackInput = Omit<StoreTranscriptInput, "slug" | "asset">;

export interface TranslateTargetsInput {
	track: SpokenTrack;
	targets: string[];
	meter: UsageMeter;
	signal: AbortSignal;
	concurrency: number;
	store: (input: TrackInput) => Promise<void>;
}

export function translateTargets({
	track,
	targets,
	meter,
	signal,
	concurrency,
	store
}: TranslateTargetsInput): Promise<void> {
	return forEachLimit(targets, concurrency, signal, async (targetLanguage, targetSignal) => {
		const translated = await translateSegments({
			segments: track.segments,
			sourceLanguage: track.language,
			targetLanguage,
			meter,
			signal: targetSignal
		});
		await store({
			language: targetLanguage,
			isTranslation: true,
			segments: translated.segments,
			durationSec: track.durationSec,
			model: translated.model
		});
	});
}
