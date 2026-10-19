import { z } from "zod";

const shared = {
	FFMPEG_PATH: z.string().min(1),
	FFPROBE_PATH: z.string().min(1),
	WORK_DIR: z.string().min(1),
	HEARTBEAT_SEC: z.coerce.number().positive(),
	LEASE_SEC: z.coerce.number().int().positive(),
	VISIBILITY_EXTENSION_SEC: z.coerce.number().int().positive(),
	SOURCE_URL_TTL_SEC: z.coerce.number().int().positive()
};

const fargateSchema = z.object({
	...shared,
	WORKER_TIER: z.literal("fargate"),
	WORKER_IDLE_TIMEOUT_SEC: z.coerce.number().int().positive(),
	IDLE_EXIT: z.enum(["true", "false"]).transform((value) => value === "true"),
	WORKER_MEMORY_MB: z.coerce.number().int().positive(),
	WORKER_VCPU: z.coerce.number().positive(),
	WORKER_SPOT: z.enum(["true", "false"]).transform((value) => value === "true")
});

const lambdaSchema = z.object({
	...shared,
	WORKER_TIER: z.literal("lambda"),
	AWS_LAMBDA_FUNCTION_MEMORY_SIZE: z.coerce.number().int().positive()
});

const schema = z.discriminatedUnion("WORKER_TIER", [fargateSchema, lambdaSchema]).superRefine((value, ctx) => {
	if (value.HEARTBEAT_SEC * 3 > value.LEASE_SEC) {
		ctx.addIssue({ code: "custom", message: "HEARTBEAT_SEC * 3 must be <= LEASE_SEC", path: ["LEASE_SEC"] });
	}
	if (value.VISIBILITY_EXTENSION_SEC < value.LEASE_SEC) {
		ctx.addIssue({
			code: "custom",
			message: "VISIBILITY_EXTENSION_SEC must be >= LEASE_SEC",
			path: ["VISIBILITY_EXTENSION_SEC"]
		});
	}
	if (value.VISIBILITY_EXTENSION_SEC <= value.HEARTBEAT_SEC) {
		ctx.addIssue({
			code: "custom",
			message: "VISIBILITY_EXTENSION_SEC must be > HEARTBEAT_SEC",
			path: ["VISIBILITY_EXTENSION_SEC"]
		});
	}
});

export type WorkerConfig = z.infer<typeof schema>;
export type FargateWorkerConfig = Extract<WorkerConfig, { WORKER_TIER: "fargate" }>;

let cached: WorkerConfig | undefined;

export function config(): WorkerConfig {
	if (!cached) {
		const result = schema.safeParse(process.env);
		if (!result.success) {
			const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
			throw new Error(`Invalid worker configuration: ${problems.join("; ")}`);
		}
		cached = result.data;
	}
	return cached;
}

export function fargateConfig(): FargateWorkerConfig {
	const cfg = config();
	if (cfg.WORKER_TIER !== "fargate") {
		throw new Error("Polling queues requires WORKER_TIER=fargate");
	}
	return cfg;
}

export function resetConfigForTests(): void {
	cached = undefined;
}
