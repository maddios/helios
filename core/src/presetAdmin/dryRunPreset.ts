import type { Preset, RequestMode, ResolvedPostProcess, SourceMetadata } from "@helios/contracts";
import { config } from "../config";
import { planItems, type PlannedItem } from "../pipeline";

export interface DryRunInput {
	preset: Preset;
	sourceMetadata: SourceMetadata;
	postProcess: ResolvedPostProcess;
	mode: RequestMode;
}

export function dryRunPreset({ preset, sourceMetadata, postProcess, mode }: DryRunInput): PlannedItem[] {
	return planItems({
		preset,
		source: sourceMetadata,
		postProcess,
		mode,
		thresholds: {
			maxDurationSec: config().LAMBDA_MAX_DURATION_SEC,
			maxSourceBytes: config().LAMBDA_MAX_SOURCE_BYTES
		}
	});
}
