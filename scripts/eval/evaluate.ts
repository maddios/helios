import type { SceneAnalysisResult } from "@helios/contracts";
import type { EvalArgs } from "./args";
import { messageOf } from "./errors";
import { judgeSample } from "./judge";
import { scoreSample } from "./metrics/sampleMetrics";
import { runSample } from "./runSample";
import type { EvalSample, SampleReport } from "./types";

export async function evaluateSample(sample: EvalSample, args: EvalArgs): Promise<SampleReport> {
	const run = await runSample(sample, args.effort);
	const report: SampleReport = {
		mediaId: sample.mediaId,
		durationSec: sample.durationSec,
		latencyMs: run.latencyMs,
		usage: run.usage,
		error: run.error,
		helios: run.result,
		partnrup: sample.baseline,
		metrics: run.result === undefined ? undefined : scoreSample(sample, run.result)
	};
	if (args.judge && run.result !== undefined) {
		await addJudge(report, sample, run.result);
	}
	return report;
}

async function addJudge(report: SampleReport, sample: EvalSample, result: SceneAnalysisResult): Promise<void> {
	try {
		report.judge = await judgeSample(sample, result.scenes);
	} catch (err) {
		report.judgeError = messageOf(err);
	}
}
