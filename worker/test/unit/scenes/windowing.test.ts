import { planWindows, sampleEvenly, transcriptLinesIn, allowedTimesOf } from "../../../src/scenes/windowing";
import type { StillInput } from "../../../src/scenes/types";

function stills(timesSec: number[]): StillInput[] {
	return timesSec.map((timestampSec, index) => ({ index, timestampSec, key: `key-${index}` }));
}

describe("sampleEvenly", () => {
	it.each([
		{ count: 3, max: 5, expected: [0, 1, 2] },
		{ count: 10, max: 5, expected: [0, 2, 4, 6, 8] },
		{ count: 7, max: 3, expected: [0, 2, 4] },
		{ count: 4, max: 1, expected: [0] }
	])("keeps at most $max of $count items, starting with the first", ({ count, max, expected }) => {
		const items = Array.from({ length: count }, (_, index) => index);
		expect(sampleEvenly(items, max)).toEqual(expected);
	});
});

describe("planWindows", () => {
	it("assigns a still exactly on a window boundary to the later window", () => {
		const windows = planWindows(stills([0, 3, 6, 9]), 12, 6, 120);

		expect(windows.map((window) => [window.startSec, window.endSec])).toEqual([
			[0, 6],
			[6, 12]
		]);
		expect(windows.map((window) => window.stills.map((still) => still.timestampSec))).toEqual([
			[0, 3],
			[6, 9]
		]);
	});

	it("drops windows without stills and samples each window up to maxStills", () => {
		const timesSec = Array.from({ length: 10 }, (_, index) => index * 3);
		const windows = planWindows(stills(timesSec), 60, 15, 2);

		expect(windows.map((window) => window.index)).toEqual([0, 1]);
		expect(windows.every((window) => window.stills.length <= 2)).toBe(true);
		expect(windows[0].stills.map((still) => still.index)).toEqual([0, 2]);
	});

	it("skips empty windows in the middle of the video", () => {
		const windows = planWindows(stills([0, 40]), 60, 20, 120);

		expect(windows.map((window) => window.index)).toEqual([0, 2]);
	});
});

describe("transcript lines and allowed times", () => {
	const window = { index: 0, startSec: 0, endSec: 6, stills: stills([0, 3]) };
	const segments = [
		{ start: 0.5, end: 2, text: "hello" },
		{ start: 5.9, end: 7, text: "straddles" },
		{ start: 6, end: 8, text: "next window" }
	];

	it("keeps segments that start inside the window", () => {
		expect(transcriptLinesIn(segments, window).map((line) => line.text)).toEqual(["hello", "straddles"]);
	});

	it("merges still and transcript times into one sorted, unique list", () => {
		expect(allowedTimesOf(window, transcriptLinesIn(segments, window))).toEqual([0, 0.5, 3, 5.9]);
	});

	it("always allows the window start, even without a still or line there", () => {
		const later = { index: 1, startSec: 6, endSec: 12, stills: stills([7]) };

		expect(allowedTimesOf(later, [])).toEqual([6, 7]);
	});
});
