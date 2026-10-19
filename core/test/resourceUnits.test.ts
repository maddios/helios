import type { Usage } from "@helios/contracts";
import { computeResourceUnits } from "../src/pipeline";

const GIB = 1024 ** 3;

describe("computeResourceUnits", () => {
	it("returns zeros when there is no usage", () => {
		expect(computeResourceUnits([])).toEqual({
			lambdaGbSeconds: 0,
			fargateVcpuSeconds: 0,
			fargateGbSeconds: 0,
			fargateSpotVcpuSeconds: 0,
			fargateSpotGbSeconds: 0,
			outputGb: 0,
			transcriptionAudioSeconds: 0,
			llmTokens: {}
		});
	});

	it("converts lambda compute to GB-seconds", () => {
		const units = computeResourceUnits([{ computeTier: "lambda", computeSec: 10, memoryMb: 2048 }]);
		expect(units.lambdaGbSeconds).toBe(20);
	});

	it("splits fargate on-demand and spot into separate vCPU and GB seconds", () => {
		const usages: Usage[] = [
			{ computeTier: "fargate", computeSec: 100, memoryMb: 4096, vcpu: 2, spot: false },
			{ computeTier: "fargate", computeSec: 50, memoryMb: 2048, vcpu: 1, spot: true }
		];
		expect(computeResourceUnits(usages)).toMatchObject({
			fargateVcpuSeconds: 200,
			fargateGbSeconds: 400,
			fargateSpotVcpuSeconds: 50,
			fargateSpotGbSeconds: 100
		});
	});

	it("rolls output bytes up in GiB", () => {
		const units = computeResourceUnits([
			{ computeTier: "lambda", computeSec: 1, memoryMb: 128, outputBytes: GIB / 2 },
			{ computeTier: "lambda", computeSec: 1, memoryMb: 128, outputBytes: GIB / 2 }
		]);
		expect(units.outputGb).toBe(1);
	});

	it("sums transcription audio seconds", () => {
		const units = computeResourceUnits([{ computeTier: "lambda", computeSec: 1, memoryMb: 128, audioSec: 30 }]);
		expect(units.transcriptionAudioSeconds).toBe(30);
	});

	it("sums LLM tokens per model across attempts and calls", () => {
		const units = computeResourceUnits([
			{
				computeTier: "lambda",
				computeSec: 1,
				memoryMb: 128,
				llm: [
					{ model: "gpt-6-sol", inputTokens: 100, outputTokens: 20 },
					{ model: "gpt-6-luna", inputTokens: 7, outputTokens: 1 }
				]
			},
			{
				computeTier: "lambda",
				computeSec: 1,
				memoryMb: 128,
				llm: [{ model: "gpt-6-sol", inputTokens: 50, outputTokens: 5 }]
			}
		]);
		expect(units.llmTokens).toEqual({
			"gpt-6-sol": { input: 150, output: 25 },
			"gpt-6-luna": { input: 7, output: 1 }
		});
	});
});
