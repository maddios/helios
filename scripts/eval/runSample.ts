import fs from "node:fs/promises";
import type { SceneAnalysisResult } from "@helios/contracts";
import { type ModelEffort, UsageMeter } from "@helios/core";
import { config } from "../../worker/src/config";
import { analyzeScenes, type TranscriptInput } from "../../worker/src/scenes";
import { messageOf } from "./errors";
import type { EvalSample, TokenUsage } from "./types";

export interface HeliosRun {
	result?: SceneAnalysisResult;
	error?: string;
	usage: TokenUsage;
	latencyMs: number;
}

export async function runSample(sample: EvalSample, effort: ModelEffort): Promise<HeliosRun> {
	const cfg = config();
	const meter = new UsageMeter();
	const started = performance.now();
	try {
		const result = await analyzeScenes({
			effort,
			durationSec: sample.durationSec,
			stills: sample.stills.map((still) => ({
				index: still.index,
				timestampSec: still.timestampSec,
				key: still.absPath
			})),
			resolveImage: readAsDataUrl,
			imageConcurrency: cfg.SCENES_IMAGE_CONCURRENCY,
			transcript: transcriptOf(sample),
			maxStills: cfg.SCENES_MAX_STILLS,
			windowSec: cfg.SCENES_WINDOW_SEC,
			snapToleranceSec: cfg.SCENES_SNAP_TOLERANCE_SEC,
			temperature: cfg.SCENES_TEMPERATURE,
			peopleAttributes: true,
			signal: new AbortController().signal,
			meter
		});
		return { result, usage: usageOf(meter), latencyMs: performance.now() - started };
	} catch (err) {
		return { error: messageOf(err), usage: usageOf(meter), latencyMs: performance.now() - started };
	}
}

async function readAsDataUrl(file: string): Promise<string> {
	return `data:image/jpeg;base64,${(await fs.readFile(file)).toString("base64")}`;
}

function transcriptOf(sample: EvalSample): TranscriptInput | null {
	return sample.transcript.length === 0 ? null : { language: "en", segments: sample.transcript };
}

function usageOf(meter: UsageMeter): TokenUsage {
	const calls = meter.snapshot().llm ?? [];
	return {
		inputTokens: calls.reduce((total, call) => total + call.inputTokens, 0),
		outputTokens: calls.reduce((total, call) => total + call.outputTokens, 0)
	};
}
