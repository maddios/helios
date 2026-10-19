import { z } from "zod";

export const StageSchema = z.enum(["local", "dev", "prod"]);
export type Stage = z.infer<typeof StageSchema>;

const hostList = z.string().transform((value) =>
	value
		.split(",")
		.map((host) => host.trim().toLowerCase())
		.filter((host) => host.length > 0)
);

const scalerNotifySchema = z.discriminatedUnion("SCALER_NOTIFY", [
	z.object({ SCALER_NOTIFY: z.literal("none") }),
	z.object({ SCALER_NOTIFY: z.literal("lambda"), SCALER_FUNCTION_NAME: z.string().min(1) })
]);

const baseSchema = z
	.object({
		STAGE: StageSchema,
		MONGO_URI: z.string().min(1),
		QUEUE_PREFIX: z.string().min(1),
		LAMBDA_MAX_DURATION_SEC: z.coerce.number().positive(),
		LAMBDA_MAX_SOURCE_BYTES: z.coerce.number().int().positive(),
		LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
		AWS_REGION: z.string().min(1),
		SQS_ENDPOINT: z.url().optional(),
		MEDIA_BUCKET: z.string().min(1),
		S3_ENDPOINT: z.url().optional(),
		SQS_FAIR_QUEUES: z.enum(["true", "false"]).transform((value) => value === "true"),
		CDN_BASE_URL: z.url(),
		UPLOAD_URL_EXPIRY_SEC: z.coerce.number().int().positive(),
		MAX_UPLOAD_BYTES: z.coerce.number().int().positive(),
		SSRF_ALLOWED_HOSTS: hostList,
		INGEST_TIMEOUT_SEC: z.coerce.number().int().positive(),
		SCALER_NOTIFY_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative(),
		FANOUT_RESUME_AFTER_SEC: z.coerce.number().int().positive(),
		HELIOS_AWS_ACCOUNT_ID: z.string().regex(/^\d{12}$/)
	})
	.superRefine((value, ctx) => {
		if (value.STAGE !== "local" && value.SSRF_ALLOWED_HOSTS.length > 0) {
			ctx.addIssue({
				code: "custom",
				path: ["SSRF_ALLOWED_HOSTS"],
				message: "must be empty unless STAGE is local"
			});
		}
	});

const schema = z.intersection(baseSchema, scalerNotifySchema);

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
