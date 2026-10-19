import { z } from "zod";

export const ComputeTierSchema = z.enum(["lambda", "fargate"]).describe("Compute tier used");
export type ComputeTier = z.infer<typeof ComputeTierSchema>;

export const LlmUsageSchema = z.object({
	model: z.string().describe("Model identifier of the LLM call"),
	inputTokens: z.number().describe("LLM input tokens consumed"),
	outputTokens: z.number().describe("LLM output tokens produced")
});
export type LlmUsage = z.infer<typeof LlmUsageSchema>;

const UsageBaseSchema = z.object({
	computeSec: z.number().describe("Compute time in seconds"),
	outputBytes: z.number().optional().describe("Bytes produced as output"),
	audioSec: z.number().optional().describe("Audio seconds transcribed"),
	llm: z.array(LlmUsageSchema).optional().describe("LLM calls made by the attempt")
});

const LambdaUsageSchema = UsageBaseSchema.extend({
	computeTier: z.literal("lambda"),
	memoryMb: z.number().describe("Memory allocated to the attempt in MB")
});

const FargateUsageSchema = UsageBaseSchema.extend({
	computeTier: z.literal("fargate"),
	memoryMb: z.number().describe("Memory allocated to the attempt in MB"),
	vcpu: z.number().describe("vCPUs allocated to the attempt"),
	spot: z.boolean().describe("Whether the attempt ran on spot capacity")
});

export const UsageSchema = z.discriminatedUnion("computeTier", [LambdaUsageSchema, FargateUsageSchema]);
export type Usage = z.infer<typeof UsageSchema>;

const TierUsageSchema = z.object({
	attempts: z.int().describe("Attempts run on this tier"),
	computeSec: z.number().describe("Compute seconds on this tier"),
	outputBytes: z.number().optional().describe("Bytes produced on this tier"),
	audioSec: z.number().optional().describe("Audio seconds processed on this tier")
});

export const UsageSummarySchema = z.object({
	byTier: z
		.object({ lambda: TierUsageSchema.optional(), fargate: TierUsageSchema.optional() })
		.describe("Usage rolled up per compute tier, only for tiers that ran")
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
