import { z } from "zod";

const schema = z.object({
	OPENAI_BASE_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
	OPENAI_API_KEY: z.string().min(1),
	OPENAI_ORG: z.string().min(1).optional(),
	OPENAI_TIMEOUT_SEC: z.coerce.number().int().positive(),
	OPENAI_TRANSCRIBE_TIMEOUT_SEC: z.coerce.number().int().positive(),
	OPENAI_MAX_ATTEMPTS: z.coerce.number().int().positive(),
	OPENAI_MAX_RETRY_AFTER_SEC: z.coerce.number().int().positive()
});

export type AiConfig = z.infer<typeof schema>;

let cached: AiConfig | undefined;

export function aiConfig(): AiConfig {
	cached ??= schema.parse(process.env);
	return cached;
}

export function resetAiConfigForTests(): void {
	cached = undefined;
}
