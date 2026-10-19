import type { BoundaryScore } from "../types";

export const BOUNDARY_TOLERANCE_SEC = 3;

export function scoreBoundaries(
	predictedStarts: number[],
	expectedStarts: number[],
	toleranceSec: number
): BoundaryScore {
	const predicted = interiorBoundaries(predictedStarts);
	const expected = interiorBoundaries(expectedStarts);
	const matched = countMatches(predicted, expected, toleranceSec);
	const precision = share(matched, predicted.length, expected.length);
	const recall = share(matched, expected.length, predicted.length);
	const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
	return { precision, recall, f1 };
}

function interiorBoundaries(starts: number[]): number[] {
	return [...new Set(starts.filter((start) => start > 0))].sort((a, b) => a - b);
}

function share(matched: number, total: number, otherTotal: number): number {
	if (total === 0) {
		return otherTotal === 0 ? 1 : 0;
	}
	return matched / total;
}

function countMatches(predicted: number[], expected: number[], toleranceSec: number): number {
	const used = new Set<number>();
	let matches = 0;
	for (const time of predicted) {
		const index = nearestUnused(expected, used, time, toleranceSec);
		if (index !== undefined) {
			used.add(index);
			matches += 1;
		}
	}
	return matches;
}

function nearestUnused(expected: number[], used: Set<number>, time: number, toleranceSec: number): number | undefined {
	let best: number | undefined;
	for (const [index, candidate] of expected.entries()) {
		const distance = Math.abs(candidate - time);
		if (used.has(index) || distance > toleranceSec) {
			continue;
		}
		if (best === undefined || distance < Math.abs(expected[best] - time)) {
			best = index;
		}
	}
	return best;
}
