import type { TranscriptSegment } from "@helios/contracts";

export interface ChunkSegments {
	keepFrom: number;
	keepUntil: number;
	offset: number;
	segments: TranscriptSegment[];
}

export function mergeSegments(chunks: ChunkSegments[]): TranscriptSegment[] {
	const kept = chunks
		.flatMap(({ keepFrom, keepUntil, offset, segments }) =>
			segments
				.map((segment) => ({ start: segment.start + offset, end: segment.end + offset, text: segment.text }))
				.filter((segment) => {
					const midpoint = (segment.start + segment.end) / 2;
					return midpoint >= keepFrom && midpoint < keepUntil;
				})
		)
		.filter((segment) => segment.text.trim() !== "")
		.sort((a, b) => a.start - b.start);
	return kept.flatMap((segment, index) => {
		const next = kept[index + 1];
		const end = next === undefined ? segment.end : Math.min(segment.end, next.start);
		return end > segment.start ? [{ ...segment, end }] : [];
	});
}
