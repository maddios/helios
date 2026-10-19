import { z } from "zod";

const csvList = z
	.string()
	.transform((value) =>
		value
			.split(",")
			.map((item) => item.trim())
			.filter((item) => item.length > 0)
	)
	.pipe(z.array(z.string()).min(1));

const schema = z
	.object({
		ECS_CLUSTER: z.string().min(1),
		WORKER_TASK_DEFINITION: z.string().min(1),
		WORKER_CONTAINER_NAME: z.string().min(1),
		WORKER_SUBNETS: csvList,
		WORKER_SECURITY_GROUPS: csvList,
		WARM_WORKERS: z.coerce.number().int().nonnegative(),
		MAX_WORKERS: z.coerce.number().int().positive(),
		WORKER_SPOT: z.enum(["true", "false"]).transform((value) => value === "true")
	})
	.superRefine((value, ctx) => {
		if (value.WARM_WORKERS > value.MAX_WORKERS) {
			ctx.addIssue({ code: "custom", path: ["WARM_WORKERS"], message: "must be <= MAX_WORKERS" });
		}
	});

export type ScalerConfig = z.infer<typeof schema>;

let cached: ScalerConfig | undefined;

export function scalerConfig(): ScalerConfig {
	if (cached === undefined) {
		const result = schema.safeParse(process.env);
		if (!result.success) {
			const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
			throw new Error(`Invalid scaler configuration: ${problems.join("; ")}`);
		}
		cached = result.data;
	}
	return cached;
}

export function resetScalerConfigForTests(): void {
	cached = undefined;
}
