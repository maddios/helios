import { z } from "zod";

export const ComputeTierSchema = z.enum(["lambda", "fargate"]).describe("Compute tier used");
export type ComputeTier = z.infer<typeof ComputeTierSchema>;

const UsageBaseSchema = z.object({
	computeSec: z.number().describe("Compute time in seconds"),
	outputBytes: z.number().optional().describe("Bytes produced as output"),
	audioSec: z.number().optional().describe("Audio seconds processed"),
	llmInputTokens: z.number().optional().describe("LLM input tokens consumed"),
	llmOutputTokens: z.number().optional().describe("LLM output tokens produced"),
	model: z.string().optional().describe("Model identifier used for LLM or transcription calls")
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

export const UsageSchema = z
	.discriminatedUnion("computeTier", [LambdaUsageSchema, FargateUsageSchema])
	.superRefine((usage, ctx) => {
		const hasLlmTokens = usage.llmInputTokens !== undefined || usage.llmOutputTokens !== undefined;
		if (hasLlmTokens && usage.model === undefined) {
			ctx.addIssue({ code: "custom", message: "LLM tokens require a model", path: ["model"] });
		}
	});
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
