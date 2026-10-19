import { z } from "zod";
import { aiConfig } from "./config";
import { CHAT_MODELS, type ModelEffort } from "./models";
import { ModelOutputError, ModelRefusalError, StrictSchemaError } from "./errors";
import { openaiRequest } from "./openaiRequest";
import type { UsageMeter } from "./usageMeter";

const ChatUsageSchema = z.object({
	usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() })
});

const ChatChoicesSchema = z.object({
	choices: z
		.array(
			z.object({
				message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() })
			})
		)
		.min(1)
});

export type ChatContentPart =
	{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" | "high" | "auto" } };

export interface ChatJsonInput<T> {
	effort: ModelEffort;
	system: string;
	user: string | ChatContentPart[];
	schema: z.ZodType<T>;
	schemaName: string;
	temperature?: number;
	meter: UsageMeter;
	signal: AbortSignal;
}

export async function chatJson<T>({
	effort,
	system,
	user,
	schema,
	schemaName,
	temperature,
	meter,
	signal
}: ChatJsonInput<T>): Promise<T> {
	const model = CHAT_MODELS[effort];
	const body = await openaiRequest({
		path: "/chat/completions",
		body: {
			model,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user }
			],
			response_format: {
				type: "json_schema",
				json_schema: { name: schemaName, strict: true, schema: toJsonSchema(schema) }
			},
			...(temperature !== undefined && { temperature })
		},
		timeoutSec: aiConfig().OPENAI_TIMEOUT_SEC,
		signal
	});
	const { usage } = ChatUsageSchema.parse(body);
	meter.recordLlm({ model, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens });
	const { message } = ChatChoicesSchema.parse(body).choices[0];
	if (message.refusal) {
		throw new ModelRefusalError();
	}
	if (!message.content) {
		throw new ModelOutputError("Model returned no content");
	}
	return parseContent(message.content, schema);
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
	const { $schema: _draft, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
	assertStrict(jsonSchema, "$");
	return jsonSchema;
}

function assertStrict(node: unknown, path: string): void {
	if (Array.isArray(node)) {
		node.forEach((item, index) => assertStrict(item, `${path}[${index}]`));
		return;
	}
	if (typeof node !== "object" || node === null) {
		return;
	}
	const { properties = {}, required = [] } = node as { properties?: Record<string, unknown>; required?: string[] };
	for (const [key, child] of Object.entries(properties)) {
		if (!required.includes(key)) {
			throw new StrictSchemaError(`${path}.${key}`);
		}
		assertStrict(child, `${path}.${key}`);
	}
	for (const [key, child] of Object.entries(node)) {
		if (key !== "properties") {
			assertStrict(child, `${path}.${key}`);
		}
	}
}

function parseContent<T>(content: string, schema: z.ZodType<T>): T {
	let raw: unknown;
	try {
		raw = JSON.parse(content);
	} catch (cause) {
		throw new ModelOutputError("Model output is not valid JSON", { cause });
	}
	const result = schema.safeParse(raw);
	if (!result.success) {
		throw new ModelOutputError(`Model output failed schema validation: ${result.error.message}`);
	}
	return result.data;
}
