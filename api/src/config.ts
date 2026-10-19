import { z } from "zod";

const MAX_ANALYZE_TIMEOUT_SEC = 45;

const schema = z.object({
	API_PORT: z.coerce.number().int().min(0).max(65535),
	RETRY_AFTER_SEC: z.coerce.number().int().positive(),
	SHUTDOWN_DRAIN_SEC: z.coerce.number().int().positive(),
	REDELIVER_COOLDOWN_SEC: z.coerce.number().int().positive(),
	DESTINATION_TEST_COOLDOWN_SEC: z.coerce.number().int().positive(),
	ANALYZE_TIMEOUT_SEC: z.coerce
		.number()
		.int()
		.positive()
		.max(
			MAX_ANALYZE_TIMEOUT_SEC,
			`must be at most ${MAX_ANALYZE_TIMEOUT_SEC} so sync analysis fits the 60s load balancer idle timeout`
		)
});

let cached: z.infer<typeof schema> | undefined;

export function apiConfig(): z.infer<typeof schema> {
	cached ??= schema.parse(process.env);
	return cached;
}
