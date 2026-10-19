import fs from "node:fs/promises";
import path from "node:path";
import { CHAT_MODELS } from "@helios/core";
import { config } from "../../worker/src/config";
import { type EvalArgs, parseEvalArgs } from "./args";
import { prepareEvalEnv } from "./env";
import { evaluateSample } from "./evaluate";
import { messageOf } from "./errors";
import { aggregate } from "./metrics/aggregate";
import { renderReport } from "./report/renderReport";
import { loadSamples } from "./samples";
import type { EvalSample, SampleReport } from "./types";

async function main(): Promise<void> {
	const args = parseEvalArgs(process.argv.slice(2));
	const closeEnv = await prepareEvalEnv(args.mock);
	try {
		const samples = await loadSamples(args.samplesDir, args.limit);
		const reports = await evaluateAll(samples, args);
		await writeRun(args, samples, reports);
		process.exitCode = reports.some((report) => report.error !== undefined) ? 1 : 0;
	} finally {
		await closeEnv();
	}
}

async function evaluateAll(samples: EvalSample[], args: EvalArgs): Promise<SampleReport[]> {
	const reports: SampleReport[] = [];
	for (const [position, sample] of samples.entries()) {
		const report = await evaluateSample(sample, args);
		reports.push(report);
		console.log(describe(report, position + 1, samples.length));
	}
	return reports;
}

function describe(report: SampleReport, position: number, total: number): string {
	const label = `[${position}/${total}] media ${report.mediaId}`;
	if (report.error !== undefined) {
		return `${label}: error: ${report.error}`;
	}
	return `${label}: ok in ${(report.latencyMs / 1000).toFixed(1)}s, ${report.helios?.scenes.length ?? 0} scenes (partnrup ${report.partnrup.scenes.length})`;
}

async function writeRun(args: EvalArgs, samples: EvalSample[], reports: SampleReport[]): Promise<void> {
	const runDir = path.join(args.outDir, args.effort);
	const generatedAt = new Date().toISOString();
	const summary = aggregate(reports);
	const cfg = config();
	await fs.mkdir(runDir, { recursive: true });
	await fs.writeFile(
		path.join(runDir, "results.json"),
		JSON.stringify(
			{
				effort: args.effort,
				model: CHAT_MODELS[args.effort],
				mock: args.mock,
				generatedAt,
				config: {
					maxStills: cfg.SCENES_MAX_STILLS,
					windowSec: cfg.SCENES_WINDOW_SEC,
					snapToleranceSec: cfg.SCENES_SNAP_TOLERANCE_SEC,
					temperature: cfg.SCENES_TEMPERATURE,
					peopleAttributes: true
				},
				aggregate: summary,
				samples: reports
			},
			null,
			"\t"
		)
	);
	await fs.writeFile(
		path.join(runDir, "report.html"),
		renderReport({
			reportDir: runDir,
			effort: args.effort,
			mock: args.mock,
			generatedAt,
			aggregate: summary,
			reports,
			samples
		})
	);
	console.log(
		`Wrote ${path.join(runDir, "report.html")} (${reports.length - summary.failed} of ${reports.length} videos ok)`
	);
}

main().catch((err: unknown) => {
	console.error(messageOf(err));
	process.exitCode = 1;
});
