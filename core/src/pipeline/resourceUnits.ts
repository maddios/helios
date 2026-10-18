import type { ResourceUnits, Usage } from "@helios/contracts";

const MB_PER_GB = 1024;
const BYTES_PER_GIB = 1024 ** 3;

export function computeResourceUnits(usages: Usage[]): ResourceUnits {
	const units: ResourceUnits = {
		lambdaGbSeconds: 0,
		fargateVcpuSeconds: 0,
		fargateGbSeconds: 0,
		fargateSpotVcpuSeconds: 0,
		fargateSpotGbSeconds: 0,
		outputGb: 0,
		transcriptionAudioSeconds: 0,
		llmTokens: {}
	};
	for (const usage of usages) {
		addCompute(units, usage);
		units.outputGb += (usage.outputBytes ?? 0) / BYTES_PER_GIB;
		units.transcriptionAudioSeconds += usage.audioSec ?? 0;
		addLlmTokens(units, usage);
	}
	return units;
}

function addCompute(units: ResourceUnits, usage: Usage): void {
	const gb = usage.memoryMb / MB_PER_GB;
	if (usage.computeTier === "lambda") {
		units.lambdaGbSeconds += usage.computeSec * gb;
		return;
	}
	const vcpuSeconds = usage.computeSec * usage.vcpu;
	const gbSeconds = usage.computeSec * gb;
	if (usage.spot) {
		units.fargateSpotVcpuSeconds += vcpuSeconds;
		units.fargateSpotGbSeconds += gbSeconds;
	} else {
		units.fargateVcpuSeconds += vcpuSeconds;
		units.fargateGbSeconds += gbSeconds;
	}
}

function addLlmTokens(units: ResourceUnits, usage: Usage): void {
	if (usage.llmInputTokens === undefined && usage.llmOutputTokens === undefined) {
		return;
	}
	if (usage.model === undefined) {
		throw new Error("LLM usage requires a model");
	}
	const total = units.llmTokens[usage.model] ?? { input: 0, output: 0 };
	units.llmTokens[usage.model] = {
		input: total.input + (usage.llmInputTokens ?? 0),
		output: total.output + (usage.llmOutputTokens ?? 0)
	};
}
