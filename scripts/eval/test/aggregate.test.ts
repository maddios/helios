import { aggregate } from "../metrics/aggregate";
import type { SampleMetrics, SampleReport } from "../types";

const metrics: SampleMetrics = {
	heliosSceneCount: 4,
	partnrupSceneCount: 6,
	schemaValid: true,
	timesDrawn: true,
	coverageOk: false,
	representativeValid: 1,
	representativeInScene: 0.5,
	personFieldCoverage: null,
	boundaries: { precision: 0.5, recall: 1, f1: 2 / 3 }
};

function report(overrides: Partial<SampleReport>): SampleReport {
	return {
		mediaId: 1,
		durationSec: 30,
		latencyMs: 1000,
		usage: { inputTokens: 100, outputTokens: 10 },
		partnrup: { scenes: [], invalidCount: 0 },
		metrics,
		...overrides
	};
}

describe("aggregate", () => {
	it("averages metrics over successful videos only and counts failures", () => {
		const result = aggregate([
			report({ mediaId: 1 }),
			report({ mediaId: 2, metrics: { ...metrics, coverageOk: true, heliosSceneCount: 8 } }),
			report({
				mediaId: 3,
				error: "OpenAI request failed (openai_429_insufficient_quota)",
				metrics: undefined,
				usage: { inputTokens: 0, outputTokens: 0 }
			})
		]);
		expect(result.samples).toBe(3);
		expect(result.failed).toBe(1);
		expect(result.coverageOk).toBe(0.5);
		expect(result.meanHeliosScenes).toBe(6);
		expect(result.boundaries.precision).toBe(0.5);
		expect(result.personFieldCoverage).toBeNull();
		expect(result.tokens).toEqual({ inputTokens: 200, outputTokens: 20 });
	});

	it("reports null judge means when no video was judged", () => {
		const result = aggregate([report({})]);
		expect(result.judge).toEqual({ boundaryQuality: null, descriptionAccuracy: null, completeness: null });
		expect(result.judgeFailed).toBe(0);
	});

	it("averages judge scores and counts judge failures", () => {
		const judge = { boundaryQuality: 4, descriptionAccuracy: 3, completeness: 5, rationale: "ok" };
		const result = aggregate([
			report({ judge }),
			report({ mediaId: 2, judge: { ...judge, boundaryQuality: 2 } }),
			report({ mediaId: 3, judgeError: "quota" })
		]);
		expect(result.judge).toEqual({ boundaryQuality: 3, descriptionAccuracy: 3, completeness: 5 });
		expect(result.judgeFailed).toBe(1);
	});
});
