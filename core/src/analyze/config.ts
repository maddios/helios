import { z } from "zod";

const schema = z.object({
	FFPROBE_PATH: z.string().min(1),
	ANALYZE_TIMEOUT_SEC: z.coerce.number().int().positive(),
	SOURCE_URL_TTL_SEC: z.coerce.number().int().positive(),
	MAX_INGEST_BYTES: z.coerce.number().int().positive()
});

export type AnalyzeConfig = z.infer<typeof schema>;

let cached: AnalyzeConfig | undefined;

export function analyzeConfig(): AnalyzeConfig {
	if (cached === undefined) {
		const result = schema.safeParse(process.env);
		if (!result.success) {
			const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
			throw new Error(`Invalid analyze configuration: ${problems.join("; ")}`);
		}
		cached = result.data;
	}
	return cached;
}

export function resetAnalyzeConfigForTests(): void {
	cached = undefined;
}
