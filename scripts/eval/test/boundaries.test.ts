import { scoreBoundaries } from "../metrics/boundaries";

describe("scoreBoundaries", () => {
	it("matches boundaries within tolerance and ignores t=0", () => {
		const score = scoreBoundaries([0, 10, 21], [0, 12, 40], 3);
		expect(score.precision).toBeCloseTo(1 / 2);
		expect(score.recall).toBeCloseTo(1 / 2);
		expect(score.f1).toBeCloseTo(1 / 2);
	});

	it("matches each expected boundary at most once", () => {
		const score = scoreBoundaries([10, 11], [10], 3);
		expect(score.precision).toBeCloseTo(1 / 2);
		expect(score.recall).toBe(1);
	});

	it("scores zero when every boundary is outside tolerance", () => {
		expect(scoreBoundaries([10], [20], 3)).toEqual({ precision: 0, recall: 0, f1: 0 });
	});

	it("scores agreement on no boundaries as perfect and one-sided emptiness as zero", () => {
		expect(scoreBoundaries([0], [0], 3)).toEqual({ precision: 1, recall: 1, f1: 1 });
		expect(scoreBoundaries([], [10], 3)).toEqual({ precision: 0, recall: 0, f1: 0 });
	});
});
