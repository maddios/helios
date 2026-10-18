import { z } from "zod";

const schema = z.object({
	MONGO_URI: z.string().min(1),
	QUEUE_PREFIX: z.string().min(1),
	LAMBDA_MAX_DURATION_SEC: z.coerce.number().positive(),
	LAMBDA_MAX_SOURCE_BYTES: z.coerce.number().int().positive(),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
	AWS_REGION: z.string().min(1),
	SQS_ENDPOINT: z.url().optional(),
	MEDIA_BUCKET: z.string().min(1),
	S3_ENDPOINT: z.url().optional(),
	SQS_FAIR_QUEUES: z.enum(["true", "false"]).transform((value) => value === "true")
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

function parse(env: NodeJS.ProcessEnv): Config {
	const result = schema.safeParse(env);
	if (!result.success) {
		const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
		throw new Error(`Invalid configuration: ${problems.join("; ")}`);
	}
	return result.data;
}

export function config(): Config {
	cached ??= parse(process.env);
	return cached;
}

export function resetConfigForTests(): void {
	cached = undefined;
}
