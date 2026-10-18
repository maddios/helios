import { z } from "zod";

const schema = z
	.object({
		FFMPEG_PATH: z.string().min(1),
		FFPROBE_PATH: z.string().min(1),
		WORK_DIR: z.string().min(1),
		WORKER_TIER: z.enum(["lambda", "fargate"]),
		HEARTBEAT_SEC: z.coerce.number().positive(),
		LEASE_SEC: z.coerce.number().int().positive(),
		VISIBILITY_EXTENSION_SEC: z.coerce.number().int().positive(),
		SOURCE_URL_TTL_SEC: z.coerce.number().int().positive(),
		WORKER_IDLE_TIMEOUT_SEC: z.coerce.number().int().positive(),
		IDLE_EXIT: z.enum(["true", "false"]).transform((value) => value === "true"),
		WORKER_MEMORY_MB: z.coerce.number().int().positive(),
		WORKER_VCPU: z.coerce.number().positive(),
		WORKER_SPOT: z.enum(["true", "false"]).transform((value) => value === "true")
	})
	.superRefine((value, ctx) => {
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

export function resetConfigForTests(): void {
	cached = undefined;
}
