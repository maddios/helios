import { mergeSegments } from "../../../src/transcribe/mergeSegments";

describe("mergeSegments", () => {
	it("offsets segments by the window start", () => {
		expect(
			mergeSegments([{ keepFrom: 0, keepUntil: Infinity, offset: 10, segments: [{ start: 0, end: 2, text: "a" }] }])
		).toEqual([{ start: 10, end: 12, text: "a" }]);
	});

	it("keeps a boundary segment exactly once, in the chunk whose window holds its midpoint", () => {
		const merged = mergeSegments([
			{ keepFrom: 0, keepUntil: 10, offset: 0, segments: [{ start: 9, end: 11, text: "boundary" }] },
			{ keepFrom: 10, keepUntil: Infinity, offset: 8, segments: [{ start: 1, end: 3, text: "boundary" }] }
		]);

		expect(merged).toEqual([{ start: 9, end: 11, text: "boundary" }]);
	});

	it("removes an overlap duplicate reported by both windows", () => {
		const merged = mergeSegments([
			{ keepFrom: 0, keepUntil: 10, offset: 0, segments: [{ start: 9, end: 10, text: "shared" }] },
			{ keepFrom: 10, keepUntil: Infinity, offset: 8, segments: [{ start: 1, end: 2, text: "shared" }] }
		]);

		expect(merged).toEqual([{ start: 9, end: 10, text: "shared" }]);
	});

	it("loses no segment at a boundary when windows report neighbours", () => {
		const merged = mergeSegments([
			{
				keepFrom: 0,
				keepUntil: 10,
				offset: 0,
				segments: [
					{ start: 4, end: 6, text: "one" },
					{ start: 9, end: 11, text: "two" }
				]
			},
			{
				keepFrom: 10,
				keepUntil: Infinity,
				offset: 8,
				segments: [
					{ start: 1, end: 3, text: "two" },
					{ start: 4, end: 6, text: "three" }
				]
			}
		]);

		expect(merged.map((segment) => segment.text)).toEqual(["one", "two", "three"]);
	});

	it("sorts segments by start across windows", () => {
		const merged = mergeSegments([
			{ keepFrom: 10, keepUntil: Infinity, offset: 10, segments: [{ start: 0, end: 1, text: "late" }] },
			{ keepFrom: 0, keepUntil: 10, offset: 0, segments: [{ start: 2, end: 3, text: "early" }] }
		]);

		expect(merged.map((segment) => segment.text)).toEqual(["early", "late"]);
	});

	it("clamps each end to the next start so segments never overlap", () => {
		const merged = mergeSegments([
			{
				keepFrom: 0,
				keepUntil: Infinity,
				offset: 0,
				segments: [
					{ start: 0, end: 5, text: "a" },
					{ start: 2, end: 3, text: "b" },
					{ start: 4, end: 6, text: "c" }
				]
			}
		]);

		expect(merged).toEqual([
			{ start: 0, end: 2, text: "a" },
			{ start: 2, end: 3, text: "b" },
			{ start: 4, end: 6, text: "c" }
		]);
	});

	it("drops a segment that its successor's start leaves with no duration", () => {
		const merged = mergeSegments([
			{
				keepFrom: 0,
				keepUntil: Infinity,
				offset: 0,
				segments: [
					{ start: 0, end: 5, text: "covered" },
					{ start: 0, end: 1, text: "kept" }
				]
			}
		]);

		expect(merged).toEqual([{ start: 0, end: 1, text: "kept" }]);
	});

	it("drops segments whose text is blank and keeps other text unchanged", () => {
		const merged = mergeSegments([
			{
				keepFrom: 0,
				keepUntil: Infinity,
				offset: 0,
				segments: [
					{ start: 0, end: 1, text: "   " },
					{ start: 1, end: 2, text: "" },
					{ start: 2, end: 3, text: " 2024 " }
				]
			}
		]);

		expect(merged).toEqual([{ start: 2, end: 3, text: " 2024 " }]);
	});
});
