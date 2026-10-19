import type { JudgeScores, SampleMetrics, SampleReport, TokenUsage } from "../types";
import { average } from "./stats";

export interface Aggregate {
	samples: number;
	failed: number;
	judgeFailed: number;
	schemaValid: number | null;
	timesDrawn: number | null;
	coverageOk: number | null;
	representativeValid: number | null;
	representativeInScene: number | null;
	personFieldCoverage: number | null;
	meanHeliosScenes: number | null;
	meanPartnrupScenes: number | null;
	partnrupInvalid: number;
	boundaries: { precision: number | null; recall: number | null; f1: number | null };
	tokens: TokenUsage;
	meanLatencyMs: number | null;
	judge: { boundaryQuality: number | null; descriptionAccuracy: number | null; completeness: number | null };
}

export function aggregate(reports: SampleReport[]): Aggregate {
	const scored = reports.flatMap((report) => (report.metrics === undefined ? [] : [report.metrics]));
	const judged = reports.flatMap((report) => (report.judge === undefined ? [] : [report.judge]));
	const flag = (pick: (metrics: SampleMetrics) => boolean) => average(scored.map((metrics) => (pick(metrics) ? 1 : 0)));
	const mean = (pick: (metrics: SampleMetrics) => number | null) => average(scored.map(pick));
	const judgeMean = (pick: (scores: JudgeScores) => number) => average(judged.map(pick));
	return {
		samples: reports.length,
		failed: reports.filter((report) => report.error !== undefined).length,
		judgeFailed: reports.filter((report) => report.judgeError !== undefined).length,
		schemaValid: flag((metrics) => metrics.schemaValid),
		timesDrawn: flag((metrics) => metrics.timesDrawn),
		coverageOk: flag((metrics) => metrics.coverageOk),
		representativeValid: mean((metrics) => metrics.representativeValid),
		representativeInScene: mean((metrics) => metrics.representativeInScene),
		personFieldCoverage: mean((metrics) => metrics.personFieldCoverage),
		meanHeliosScenes: mean((metrics) => metrics.heliosSceneCount),
		meanPartnrupScenes: mean((metrics) => metrics.partnrupSceneCount),
		partnrupInvalid: reports.reduce((total, report) => total + report.partnrup.invalidCount, 0),
		boundaries: {
			precision: mean((metrics) => metrics.boundaries.precision),
			recall: mean((metrics) => metrics.boundaries.recall),
			f1: mean((metrics) => metrics.boundaries.f1)
		},
		tokens: {
			inputTokens: reports.reduce((total, report) => total + report.usage.inputTokens, 0),
			outputTokens: reports.reduce((total, report) => total + report.usage.outputTokens, 0)
		},
		meanLatencyMs: average(reports.map((report) => report.latencyMs)),
		judge: {
			boundaryQuality: judgeMean((scores) => scores.boundaryQuality),
			descriptionAccuracy: judgeMean((scores) => scores.descriptionAccuracy),
			completeness: judgeMean((scores) => scores.completeness)
		}
	};
}
