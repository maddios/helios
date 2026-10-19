import type { TranscriptSegment } from "@helios/contracts";
import { parseSrt, parseVtt, toSrt, toText, toVtt } from "../../src/captions";

const SEGMENTS: TranscriptSegment[] = [
	{ start: 0, end: 1.5, text: "Hello there" },
	{ start: 1.5, end: 3.25, text: "2024" },
	{ start: 3.25, end: 4, text: "0" },
	{ start: 4, end: 6.001, text: "" },
	{ start: 6.001, end: 9.999, text: "first line\nsecond line" },
	{ start: 360000.5, end: 360001.125, text: "far away" }
];

describe("captions", () => {
	it("writes SRT with positional indexes and comma milliseconds", () => {
		expect(toSrt(SEGMENTS.slice(0, 2))).toBe(
			"1\n00:00:00,000 --> 00:00:01,500\nHello there\n\n2\n00:00:01,500 --> 00:00:03,250\n2024\n\n"
		);
	});

	it("writes WEBVTT with dot milliseconds and a header", () => {
		expect(toVtt(SEGMENTS.slice(0, 1))).toBe("WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nHello there\n\n");
	});

	it("writes plain text one segment per line", () => {
		expect(toText(SEGMENTS.slice(0, 3))).toBe("Hello there\n2024\n0");
	});

	it("floors milliseconds and writes hours above 99 without truncation", () => {
		expect(toSrt([{ start: 1.9999, end: 360000.5, text: "x" }])).toBe("1\n00:00:01,999 --> 100:00:00,500\nx\n\n");
	});

	it("round-trips SRT, including numeric-only, empty, multi-line and hour-long cues", () => {
		expect(parseSrt(toSrt(SEGMENTS))).toEqual(SEGMENTS);
	});

	it("round-trips VTT, including numeric-only, empty, multi-line and hour-long cues", () => {
		expect(parseVtt(toVtt(SEGMENTS))).toEqual(SEGMENTS);
	});

	it("parses cues whose text is a bare number, which an index-based parser would drop", () => {
		expect(parseSrt("1\n00:00:00,000 --> 00:00:02,000\n7\n\n2\n00:00:02,000 --> 00:00:03,000\n8\n")).toEqual([
			{ start: 0, end: 2, text: "7" },
			{ start: 2, end: 3, text: "8" }
		]);
	});

	it("parses SRT with CRLF line endings and VTT cues without a header or hours", () => {
		expect(parseSrt("1\r\n00:00:00,500 --> 00:00:01,000\r\nhi\r\n")).toEqual([{ start: 0.5, end: 1, text: "hi" }]);
		expect(parseVtt("WEBVTT\n\nintro\n00:01.000 --> 00:02.000\nhi\n")).toEqual([{ start: 1, end: 2, text: "hi" }]);
	});

	it("escapes &, < and > in VTT cue text and restores them when parsed", () => {
		const segments: TranscriptSegment[] = [{ start: 0, end: 1, text: "Tom & Jerry <i>x</i> > y" }];

		expect(toVtt(segments)).toContain("Tom &amp; Jerry &lt;i&gt;x&lt;/i&gt; &gt; y");
		expect(parseVtt(toVtt(segments))).toEqual(segments);
		expect(toSrt(segments)).toContain("Tom & Jerry <i>x</i> > y");
	});

	it("returns no segments for empty input", () => {
		expect(parseSrt("")).toEqual([]);
		expect(parseVtt("WEBVTT\n\n")).toEqual([]);
	});
});
