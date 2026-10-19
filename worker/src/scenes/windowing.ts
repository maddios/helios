import type { TranscriptSegment } from "@helios/contracts";
import type { StillInput } from "./types";

export interface SceneWindow {
	index: number;
	startSec: number;
	endSec: number;
	stills: StillInput[];
}

export function planWindows(
	stills: StillInput[],
	durationSec: number,
	windowSec: number,
	maxStills: number
): SceneWindow[] {
	const sorted = [...stills].sort((a, b) => a.timestampSec - b.timestampSec);
	const count = Math.ceil(durationSec / windowSec);
	return Array.from({ length: count }, (_, index): SceneWindow => {
		const startSec = index * windowSec;
		const endSec = Math.min(startSec + windowSec, durationSec);
		const inWindow = sorted.filter((still) => still.timestampSec >= startSec && still.timestampSec < endSec);
		return { index, startSec, endSec, stills: sampleEvenly(inWindow, maxStills) };
	}).filter((window) => window.stills.length > 0);
}

export function sampleEvenly<T>(items: T[], max: number): T[] {
	if (items.length <= max) {
		return items;
	}
	return Array.from({ length: max }, (_, position) => items[Math.floor((position * items.length) / max)]);
}

export function transcriptLinesIn(segments: TranscriptSegment[], window: SceneWindow): TranscriptSegment[] {
	return segments.filter((segment) => segment.start >= window.startSec && segment.start < window.endSec);
}

export function allowedTimesOf(window: SceneWindow, lines: TranscriptSegment[]): number[] {
	const times = [
		window.startSec,
		...window.stills.map((still) => still.timestampSec),
		...lines.map((line) => line.start)
	];
	return [...new Set(times)].sort((a, b) => a - b);
}
