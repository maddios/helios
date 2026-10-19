import type { TranscriptSegment } from "@helios/contracts";
import { escapeVtt } from "./vtt";
import { formatTimestamp } from "./timestamp";

export function toSrt(segments: TranscriptSegment[]): string {
	return cues(segments, ",");
}

export function toVtt(segments: TranscriptSegment[]): string {
	return `WEBVTT\n\n${cues(
		segments.map((segment) => ({ ...segment, text: escapeVtt(segment.text) })),
		"."
	)}`;
}

export function toText(segments: TranscriptSegment[]): string {
	return segments.map((segment) => segment.text).join("\n");
}

function cues(segments: TranscriptSegment[], separator: "," | "."): string {
	return segments
		.map((segment, index) => {
			const timing = `${formatTimestamp(segment.start, separator)} --> ${formatTimestamp(segment.end, separator)}`;
			return `${[String(index + 1), timing, ...textLines(segment.text)].join("\n")}\n\n`;
		})
		.join("");
}

export function textLines(text: string): string[] {
	return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}
