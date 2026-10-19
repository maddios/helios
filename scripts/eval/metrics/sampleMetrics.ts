import { type SceneAnalysisResult, SceneAnalysisResultSchema } from "@helios/contracts";
import type { EvalSample, SampleMetrics } from "../types";
import { BOUNDARY_TOLERANCE_SEC, scoreBoundaries } from "./boundaries";
import { coverageOk, personFieldCoverage, representativeShares, timesDrawn } from "./heliosChecks";

export function scoreSample(sample: EvalSample, result: SceneAnalysisResult): SampleMetrics {
	const shares = representativeShares(result.scenes, sample.stills);
	return {
		heliosSceneCount: result.scenes.length,
		partnrupSceneCount: sample.baseline.scenes.length,
		schemaValid: SceneAnalysisResultSchema.safeParse(result).success,
		timesDrawn: timesDrawn(result.scenes, providedTimes(sample)),
		coverageOk: coverageOk(result.scenes, sample.durationSec),
		representativeValid: shares.valid,
		representativeInScene: shares.inScene,
		personFieldCoverage: personFieldCoverage(result.scenes),
		boundaries: scoreBoundaries(
			result.scenes.map((scene) => scene.startSec),
			sample.baseline.scenes.map((scene) => scene.startSec),
			BOUNDARY_TOLERANCE_SEC
		)
	};
}

function providedTimes(sample: EvalSample): number[] {
	return [...sample.stills.map((still) => still.timestampSec), ...sample.transcript.map((segment) => segment.start)];
}
