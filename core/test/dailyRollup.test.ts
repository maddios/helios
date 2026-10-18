import { dailyIncrements, mongoKey } from "../src/pipeline";

describe("mongoKey", () => {
	it("escapes percent signs before dots and dollars so the encoding is reversible", () => {
		expect(mongoKey("gpt-6.1")).toBe("gpt-6%2E1");
		expect(mongoKey("$weird.%name")).toBe("%24weird%2E%25name");
	});
});

describe("dailyIncrements", () => {
	it("increments nested LLM token paths under the encoded model key", () => {
		expect(
			dailyIncrements({
				lambdaGbSeconds: 2,
				fargateVcpuSeconds: 0,
				fargateGbSeconds: 0,
				fargateSpotVcpuSeconds: 0,
				fargateSpotGbSeconds: 0,
				outputGb: 0,
				transcriptionAudioSeconds: 0,
				llmTokens: { "gpt-6.1": { input: 10, output: 4 } }
			})
		).toMatchObject({
			"units.lambdaGbSeconds": 2,
			"units.llmTokens.gpt-6%2E1.input": 10,
			"units.llmTokens.gpt-6%2E1.output": 4
		});
	});
});
