import { z } from "zod";

const schema = z.object({
	CALLBACK_TIMEOUT_SEC: z.coerce.number().int().positive(),
	EVENTBRIDGE_ENDPOINT: z.url().optional()
});

export type CallbacksConfig = z.infer<typeof schema>;

let cached: CallbacksConfig | undefined;

export function callbacksConfig(): CallbacksConfig {
	if (cached === undefined) {
		const result = schema.safeParse(process.env);
		if (!result.success) {
			const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
			throw new Error(`Invalid callbacks configuration: ${problems.join("; ")}`);
		}
		cached = result.data;
	}
	return cached;
}

export function resetCallbacksConfigForTests(): void {
	cached = undefined;
}
