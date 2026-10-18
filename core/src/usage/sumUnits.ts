import type { ResourceUnits } from "@helios/contracts";

type LlmTokens = ResourceUnits["llmTokens"];

export function zeroUnits(): ResourceUnits {
	return {
		lambdaGbSeconds: 0,
		fargateVcpuSeconds: 0,
		fargateGbSeconds: 0,
		fargateSpotVcpuSeconds: 0,
		fargateSpotGbSeconds: 0,
		outputGb: 0,
		transcriptionAudioSeconds: 0,
		llmTokens: {}
	};
}

export function addUnits(a: ResourceUnits, b: ResourceUnits): ResourceUnits {
	return {
		lambdaGbSeconds: a.lambdaGbSeconds + b.lambdaGbSeconds,
		fargateVcpuSeconds: a.fargateVcpuSeconds + b.fargateVcpuSeconds,
		fargateGbSeconds: a.fargateGbSeconds + b.fargateGbSeconds,
		fargateSpotVcpuSeconds: a.fargateSpotVcpuSeconds + b.fargateSpotVcpuSeconds,
		fargateSpotGbSeconds: a.fargateSpotGbSeconds + b.fargateSpotGbSeconds,
		outputGb: a.outputGb + b.outputGb,
		transcriptionAudioSeconds: a.transcriptionAudioSeconds + b.transcriptionAudioSeconds,
		llmTokens: addLlmTokens(a.llmTokens, b.llmTokens)
	};
}

function addLlmTokens(a: LlmTokens, b: LlmTokens): LlmTokens {
	const sum: LlmTokens = {};
	for (const tokensByModel of [a, b]) {
		for (const [model, tokens] of Object.entries(tokensByModel)) {
			const total = sum[model] ?? { input: 0, output: 0 };
			sum[model] = { input: total.input + tokens.input, output: total.output + tokens.output };
		}
	}
	return sum;
}
