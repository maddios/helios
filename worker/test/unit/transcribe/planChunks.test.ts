import { NoAudioDurationError, planChunks } from "../../../src/transcribe/planChunks";

const OPTIONS = { maxUploadBytes: 2000, chunkSec: 100, overlapSec: 5 };

describe("planChunks", () => {
	it("returns one window covering the whole file when it fits the upload limit", () => {
		expect(planChunks(250, 2000, OPTIONS)).toEqual([
			{ index: 0, start: 0, end: 250, keepFrom: 0, keepUntil: Infinity }
		]);
	});

	it("throws a typed error for audio without duration instead of planning no windows", () => {
		expect(() => planChunks(0, 2000, OPTIONS)).toThrow(NoAudioDurationError);
		expect(() => planChunks(Number.NaN, 2000, OPTIONS)).toThrow(NoAudioDurationError);
	});

	it.each([
		{
			name: "overlaps each window on both sides and leaves the last keepUntil open",
			duration: 250,
			options: OPTIONS,
			expected: [
				{ index: 0, start: 0, end: 105, keepFrom: 0, keepUntil: 100 },
				{ index: 1, start: 95, end: 205, keepFrom: 100, keepUntil: 200 },
				{ index: 2, start: 195, end: 250, keepFrom: 200, keepUntil: Infinity }
			]
		},
		{
			name: "produces exact boundaries without overlap",
			duration: 200,
			options: { ...OPTIONS, overlapSec: 0 },
			expected: [
				{ index: 0, start: 0, end: 100, keepFrom: 0, keepUntil: 100 },
				{ index: 1, start: 100, end: 200, keepFrom: 100, keepUntil: Infinity }
			]
		},
		{
			name: "keeps a short tail window when the duration is not a multiple of the chunk",
			duration: 101,
			options: OPTIONS,
			expected: [
				{ index: 0, start: 0, end: 101, keepFrom: 0, keepUntil: 100 },
				{ index: 1, start: 95, end: 101, keepFrom: 100, keepUntil: Infinity }
			]
		}
	])("$name", ({ duration, options, expected }) => {
		expect(planChunks(duration, 3000, options)).toEqual(expected);
	});
});
