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

	it("sums transcription audio seconds and LLM tokens per model", () => {
		const units = computeResourceUnits([
			{ computeTier: "lambda", computeSec: 1, memoryMb: 128, audioSec: 30, model: "whisper" },
			{ computeTier: "lambda", computeSec: 1, memoryMb: 128, llmInputTokens: 100, llmOutputTokens: 20, model: "gpt" },
			{ computeTier: "lambda", computeSec: 1, memoryMb: 128, llmInputTokens: 50, llmOutputTokens: 5, model: "gpt" }
		]);
		expect(units.transcriptionAudioSeconds).toBe(30);
		expect(units.llmTokens).toEqual({ gpt: { input: 150, output: 25 } });
	});

	it("throws when LLM tokens have no model", () => {
		expect(() =>
			computeResourceUnits([{ computeTier: "lambda", computeSec: 1, memoryMb: 128, llmInputTokens: 1 }])
		).toThrow(/model/);
	});
});
