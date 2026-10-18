import { z } from "zod";

export const UsageSchema = z.object({
	computeTier: z.enum(["lambda", "fargate"]).optional().describe("Compute tier used"),
	computeSec: z.number().optional().describe("Compute time in seconds"),
	outputBytes: z.number().optional().describe("Bytes produced as output"),
	audioSec: z.number().optional().describe("Audio seconds processed"),
	llmInputTokens: z.number().optional().describe("LLM input tokens consumed"),
	llmOutputTokens: z.number().optional().describe("LLM output tokens produced"),
	model: z.string().optional().describe("Model identifier used for LLM calls")
});
export type Usage = z.infer<typeof UsageSchema>;
