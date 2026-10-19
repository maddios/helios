import type { LlmUsage, ResourceUnits, Usage } from "@helios/contracts";

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
		for (const call of usage.llm ?? []) {
			addLlmTokens(units, call);
		}
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

function addLlmTokens(units: ResourceUnits, call: LlmUsage): void {
	const total = units.llmTokens[call.model] ?? { input: 0, output: 0 };
	units.llmTokens[call.model] = {
		input: total.input + call.inputTokens,
		output: total.output + call.outputTokens
	};
}
