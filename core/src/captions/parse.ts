import type { TranscriptSegment } from "@helios/contracts";
import { textLines } from "./format";
import { unescapeVtt } from "./vtt";
import { parseCueTiming } from "./timestamp";

const BLOCK_SEPARATOR = /\r?\n[ \t]*\r?\n/;

export function parseSrt(text: string): TranscriptSegment[] {
	return parseCues(text);
}

export function parseVtt(text: string): TranscriptSegment[] {
	return parseCues(text).map((segment) => ({ ...segment, text: unescapeVtt(segment.text) }));
}

function parseCues(text: string): TranscriptSegment[] {
	return text.split(BLOCK_SEPARATOR).flatMap(parseBlock);
}

function parseBlock(block: string): TranscriptSegment[] {
	const lines = block.split(/\r?\n/);
	for (const [index, line] of lines.entries()) {
		const timing = parseCueTiming(line);
		if (timing !== undefined) {
			return [{ ...timing, text: textLines(lines.slice(index + 1).join("\n")).join("\n") }];
		}
	}
	return [];
}
