import { z } from "zod";

export const ResourceUnitsSchema = z.object({
	lambdaGbSeconds: z.number().describe("Lambda GB-seconds (compute seconds x memory GB)"),
	fargateVcpuSeconds: z.number().describe("Fargate on-demand vCPU-seconds"),
	fargateGbSeconds: z.number().describe("Fargate on-demand GB-seconds"),
	fargateSpotVcpuSeconds: z.number().describe("Fargate spot vCPU-seconds"),
	fargateSpotGbSeconds: z.number().describe("Fargate spot GB-seconds"),
	outputGb: z.number().describe("Output gigabytes (GiB) produced"),
	transcriptionAudioSeconds: z.number().describe("Audio seconds transcribed"),
	llmTokens: z
		.record(z.string(), z.object({ input: z.number(), output: z.number() }))
		.describe("LLM input and output tokens per model")
});
export type ResourceUnits = z.infer<typeof ResourceUnitsSchema>;
