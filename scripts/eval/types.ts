import type { SceneAnalysisResult, TranscriptSegment } from "@helios/contracts";

export interface SampleStill {
	index: number;
	timestampSec: number;
	absPath: string;
}

export interface BaselineScene {
	startSec: number;
	endSec: number;
	reason: string;
	description: string;
}

export interface Baseline {
	scenes: BaselineScene[];
	invalidCount: number;
}

export interface EvalSample {
	mediaId: number;
	durationSec: number;
	stills: SampleStill[];
	transcript: TranscriptSegment[];
	baseline: Baseline;
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
}

export interface BoundaryScore {
	precision: number;
	recall: number;
	f1: number;
}

export interface SampleMetrics {
	heliosSceneCount: number;
	partnrupSceneCount: number;
	schemaValid: boolean;
	timesDrawn: boolean;
	coverageOk: boolean;
	representativeValid: number;
	representativeInScene: number;
	personFieldCoverage: number | null;
	boundaries: BoundaryScore;
}

export interface JudgeScores {
	boundaryQuality: number;
	descriptionAccuracy: number;
	completeness: number;
	rationale: string;
}

export interface SampleReport {
	mediaId: number;
	durationSec: number;
	latencyMs: number;
	usage: TokenUsage;
	error?: string;
	helios?: SceneAnalysisResult;
	partnrup: Baseline;
	metrics?: SampleMetrics;
	judge?: JudgeScores;
	judgeError?: string;
}
