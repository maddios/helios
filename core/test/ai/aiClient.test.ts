import { z } from "zod";
import path from "node:path";
import {
	chatJson,
	languageCode,
	languageName,
	LANGUAGE_CODES,
	ModelOutputError,
	ModelRefusalError,
	OpenAIError,
	StrictSchemaError,
	transcribeAudio,
	UnknownLanguageError,
	UsageMeter,
	type ChatJsonInput,
	type TranscribeAudioInput
} from "../../src/ai";
import { parseRetryAfterMs } from "../../src/ai/openaiRequest";
import { resetAiConfigForTests } from "../../src/ai/config";
import { chatReply, startOpenAIStub, type OpenAIStub, type StubReply } from "../helpers/openaiStub";

const AUDIO = path.resolve(__dirname, "../../package.json");
const SCHEMA = z.object({ title: z.string(), tags: z.array(z.string()) });
const VALUE = { title: "Hello", tags: ["a"] };

let stub: OpenAIStub | undefined;

const DEFAULT_ENV = {
	OPENAI_BASE_URL: "http://127.0.0.1:9",
	OPENAI_TIMEOUT_SEC: "5",
	OPENAI_TRANSCRIBE_TIMEOUT_SEC: "5",
	OPENAI_MAX_ATTEMPTS: "3",
	OPENAI_MAX_RETRY_AFTER_SEC: "30"
};

async function useStub(replies: StubReply[], env: Record<string, string> = {}): Promise<OpenAIStub> {
	stub = await startOpenAIStub(replies);
	Object.assign(process.env, { ...DEFAULT_ENV, OPENAI_BASE_URL: stub.url, ...env });
	resetAiConfigForTests();
	return stub;
}

function chatInput(overrides: Partial<ChatJsonInput<unknown>> = {}): ChatJsonInput<unknown> {
	return {
		effort: "medium",
		system: "sys",
		user: "usr",
		schema: SCHEMA,
		schemaName: "summary",
		meter: new UsageMeter(),
		signal: new AbortController().signal,
		...overrides
	};
}

function transcribeInput(overrides: Partial<TranscribeAudioInput> = {}): TranscribeAudioInput {
	return { filePath: AUDIO, meter: new UsageMeter(), signal: new AbortController().signal, ...overrides };
}

async function formFields(body: Buffer, contentType: string): Promise<FormData> {
	return new Response(body, { headers: { "content-type": contentType } }).formData();
}

beforeEach(() => {
	Object.assign(process.env, DEFAULT_ENV);
	resetAiConfigForTests();
});

afterEach(async () => {
	await stub?.close();
	stub = undefined;
});

describe("transcribeAudio", () => {
	const transcription = {
		language: "german",
		duration: 3.5,
		text: " Hallo Welt",
		segments: [
			{ id: 0, start: 0, end: 1.5, text: " Hallo" },
			{ id: 1, start: 1.5, end: 3.5, text: " Welt " }
		]
	};

	it("sends OpenAI-Organization only when OPENAI_ORG is configured", async () => {
		const withOrg = await useStub([{ status: 200, body: transcription }], { OPENAI_ORG: "org-test" });
		await transcribeAudio(transcribeInput());
		expect(withOrg.requests[0].organization).toBe("org-test");
		await withOrg.close();
		stub = undefined;
		delete process.env.OPENAI_ORG;

		const withoutOrg = await useStub([{ status: 200, body: transcription }]);
		await transcribeAudio(transcribeInput());
		expect(withoutOrg.requests[0].organization).toBeUndefined();
	});

	it("does not retry a 429 caused by exhausted quota or credits", async () => {
		const server = await useStub([
			{
				status: 429,
				body: { error: { type: "insufficient_quota", code: "credit_balance_exhausted" } }
			}
		]);

		await expect(transcribeAudio(transcribeInput())).rejects.toMatchObject({
			status: 429,
			code: "insufficient_quota"
		});
		expect(server.requests).toHaveLength(1);
	});

	it("posts a multipart verbose_json request and parses segments", async () => {
		const server = await useStub([{ status: 200, body: transcription }]);

		const result = await transcribeAudio(transcribeInput());

		const request = server.requests[0];
		expect(request.url).toBe("/audio/transcriptions");
		expect(request.authorization).toBe("Bearer test-key");
		const form = await formFields(request.body, request.contentType);
		expect(form.get("model")).toBe("whisper-1");
		expect(form.get("response_format")).toBe("verbose_json");
		expect(form.get("timestamp_granularities[]")).toBe("segment");
		expect(form.get("language")).toBeNull();
		expect(form.get("file")).toBeInstanceOf(File);
		expect((form.get("file") as File).name).toBe("package.json");
		expect(result).toEqual({
			language: "de",
			durationSec: 3.5,
			segments: [
				{ start: 0, end: 1.5, text: "Hallo" },
				{ start: 1.5, end: 3.5, text: "Welt" }
			]
		});
	});

	it("records the response duration as audio seconds on the meter", async () => {
		await useStub([{ status: 200, body: transcription }]);
		const meter = new UsageMeter();

		await transcribeAudio(transcribeInput({ meter }));

		expect(meter.snapshot()).toEqual({ audioSec: 3.5 });
	});

	it("sends the language hint when given", async () => {
		const server = await useStub([{ status: 200, body: transcription }]);

		await transcribeAudio(transcribeInput({ language: "de" }));

		const form = await formFields(server.requests[0].body, server.requests[0].contentType);
		expect(form.get("language")).toBe("de");
	});

	it("rejects a detected language that is not a Whisper language, after metering the audio", async () => {
		await useStub([{ status: 200, body: { ...transcription, language: "klingon" } }]);
		const meter = new UsageMeter();

		await expect(transcribeAudio(transcribeInput({ meter }))).rejects.toBeInstanceOf(UnknownLanguageError);
		expect(meter.snapshot()).toEqual({ audioSec: 3.5 });
	});

	it("times out after OPENAI_TRANSCRIBE_TIMEOUT_SEC, separately from the chat timeout", async () => {
		const server = await useStub([{ status: 200, body: transcription, delayMs: 2500 }], {
			OPENAI_TRANSCRIBE_TIMEOUT_SEC: "1",
			OPENAI_TIMEOUT_SEC: "30",
			OPENAI_MAX_ATTEMPTS: "1"
		});

		const started = Date.now();
		const error = await transcribeAudio(transcribeInput()).catch((err: unknown) => err);

		expect(error).toMatchObject({ code: "timeout" });
		expect(Date.now() - started).toBeLessThan(2500);
		expect(server.requests).toHaveLength(1);
	});

	it("rejects with the abort reason when the signal is aborted mid-request", async () => {
		await useStub([{ status: 200, body: transcription, delayMs: 5000 }]);
		const controller = new AbortController();
		const reason = new Error("Worker stopping");
		const outcome = transcribeAudio(transcribeInput({ signal: controller.signal })).catch((err: unknown) => err);

		setTimeout(() => controller.abort(reason), 100);

		expect(await outcome).toBe(reason);
	});
});

describe("chatJson", () => {
	it("sends a strict json_schema request built from the zod schema", async () => {
		const server = await useStub([chatReply(VALUE)]);

		await chatJson(chatInput({ temperature: 0.2 }));

		const body = JSON.parse(server.requests[0].body.toString());
		expect(server.requests[0].url).toBe("/chat/completions");
		expect(server.requests[0].contentType).toBe("application/json");
		expect(body).toMatchObject({
			model: "gpt-6-sol",
			temperature: 0.2,
			messages: [
				{ role: "system", content: "sys" },
				{ role: "user", content: "usr" }
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "summary",
					strict: true,
					schema: {
						type: "object",
						additionalProperties: false,
						required: ["title", "tags"],
						properties: { title: { type: "string" }, tags: { type: "array", items: { type: "string" } } }
					}
				}
			}
		});
		expect(body.response_format.json_schema.schema).not.toHaveProperty("$schema");
	});

	it("rejects a schema with an optional field before sending any request", async () => {
		const server = await useStub([chatReply(VALUE)]);
		const schema = z.object({ title: z.string(), note: z.string().optional() });

		await expect(chatJson(chatInput({ schema }))).rejects.toBeInstanceOf(StrictSchemaError);
		expect(server.requests).toHaveLength(0);
	});

	it("accepts a nullable field in place of an optional one", async () => {
		const server = await useStub([chatReply({ title: "x", note: null })]);
		const schema = z.object({ title: z.string(), note: z.string().nullable() });

		await expect(chatJson(chatInput({ schema }))).resolves.toEqual({ title: "x", note: null });
		expect(server.requests).toHaveLength(1);
	});

	it("omits temperature when not given and maps the effort to its model", async () => {
		const server = await useStub([chatReply(VALUE)]);

		await chatJson(chatInput({ effort: "high" }));

		const body = JSON.parse(server.requests[0].body.toString());
		expect(body.model).toBe("gpt-6-astra");
		expect(body).not.toHaveProperty("temperature");
	});

	it("returns the parsed value and records the token usage on the meter", async () => {
		await useStub([chatReply(VALUE, 42, 7)]);
		const meter = new UsageMeter();

		await expect(chatJson(chatInput({ meter }))).resolves.toEqual(VALUE);
		expect(meter.snapshot()).toEqual({ llm: [{ model: "gpt-6-sol", inputTokens: 42, outputTokens: 7 }] });
	});

	it("records usage before rejecting a refusal, and does not echo the refusal text", async () => {
		await useStub([
			{
				status: 200,
				body: {
					choices: [{ message: { content: null, refusal: "cannot help with that" } }],
					usage: { prompt_tokens: 1, completion_tokens: 0 }
				}
			}
		]);
		const meter = new UsageMeter();

		const error = await chatJson(chatInput({ meter })).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(ModelRefusalError);
		expect((error as Error).message).not.toContain("cannot help");
		expect(meter.snapshot()).toEqual({ llm: [{ model: "gpt-6-sol", inputTokens: 1, outputTokens: 0 }] });
	});

	it("records usage before rejecting content that does not match the zod schema", async () => {
		await useStub([chatReply({ title: 1, tags: [] }, 5, 2)]);
		const meter = new UsageMeter();

		await expect(chatJson(chatInput({ meter }))).rejects.toBeInstanceOf(ModelOutputError);
		expect(meter.snapshot()).toEqual({ llm: [{ model: "gpt-6-sol", inputTokens: 5, outputTokens: 2 }] });
	});

	it("rejects content that is not JSON", async () => {
		await useStub([
			{
				status: 200,
				body: {
					choices: [{ message: { content: "not json", refusal: null } }],
					usage: { prompt_tokens: 1, completion_tokens: 1 }
				}
			}
		]);

		await expect(chatJson(chatInput())).rejects.toBeInstanceOf(ModelOutputError);
	});

	it("retries a 429 after the Retry-After delay", async () => {
		const server = await useStub([
			{
				status: 429,
				body: { error: { message: "slow down", code: "rate_limit_exceeded" } },
				headers: { "retry-after": "1" }
			},
			chatReply(VALUE)
		]);

		const started = Date.now();
		await expect(chatJson(chatInput())).resolves.toEqual(VALUE);

		expect(server.requests).toHaveLength(2);
		expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
	});

	it("caps a Retry-After longer than OPENAI_MAX_RETRY_AFTER_SEC", async () => {
		const server = await useStub(
			[
				{ status: 429, body: { error: { code: "rate_limit_exceeded" } }, headers: { "retry-after": "60" } },
				chatReply(VALUE)
			],
			{ OPENAI_MAX_RETRY_AFTER_SEC: "1" }
		);

		const started = Date.now();
		await expect(chatJson(chatInput())).resolves.toEqual(VALUE);

		expect(server.requests).toHaveLength(2);
		expect(Date.now() - started).toBeLessThan(5000);
	});

	it("stops waiting for a Retry-After delay as soon as the signal is aborted", async () => {
		const server = await useStub([
			{ status: 429, body: { error: { code: "rate_limit_exceeded" } }, headers: { "retry-after": "30" } },
			chatReply(VALUE)
		]);
		const controller = new AbortController();
		const started = Date.now();
		const outcome = chatJson(chatInput({ signal: controller.signal })).catch((err: unknown) => err);

		setTimeout(() => controller.abort(new Error("Worker stopping")), 200);

		expect(await outcome).toMatchObject({ name: "AbortError" });
		expect(Date.now() - started).toBeLessThan(5000);
		expect(server.requests).toHaveLength(1);
	});

	it("retries a dropped connection as a network failure", async () => {
		const server = await useStub([{ status: 200, body: {}, reset: true }, chatReply(VALUE)]);

		await expect(chatJson(chatInput())).resolves.toEqual(VALUE);
		expect(server.requests).toHaveLength(2);
	});

	it("times out a slow chat request after OPENAI_TIMEOUT_SEC", async () => {
		await useStub([{ status: 200, body: {}, delayMs: 2500 }], { OPENAI_TIMEOUT_SEC: "1", OPENAI_MAX_ATTEMPTS: "1" });

		const error = await chatJson(chatInput()).catch((err: unknown) => err);

		expect(error).toMatchObject({ code: "timeout" });
	});

	it("retries a 500 and succeeds on the next attempt", async () => {
		const server = await useStub([{ status: 500, body: { error: { message: "boom" } } }, chatReply(VALUE)]);

		await expect(chatJson(chatInput())).resolves.toEqual(VALUE);
		expect(server.requests).toHaveLength(2);
	});

	it("does not retry a 400 and does not leak the provider message", async () => {
		const server = await useStub([
			{ status: 400, body: { error: { message: "secret provider detail", code: "invalid_request" } } }
		]);

		const error = await chatJson(chatInput()).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(OpenAIError);
		expect(error).toMatchObject({ status: 400, code: "invalid_request" });
		expect((error as Error).message).toBe("OpenAI request failed (openai_400_invalid_request)");
		expect(server.requests).toHaveLength(1);
	});

	it("gives up after OPENAI_MAX_ATTEMPTS attempts", async () => {
		const server = await useStub([{ status: 503, body: { error: { message: "down" } } }], {
			OPENAI_MAX_ATTEMPTS: "2"
		});

		const error = await chatJson(chatInput()).catch((err: unknown) => err);

		expect(error).toMatchObject({ status: 503 });
		expect(server.requests).toHaveLength(2);
	});
});

describe("parseRetryAfterMs", () => {
	const now = Date.parse("2026-10-18T12:00:00Z");

	it("reads delta seconds and HTTP dates, and ignores unparseable values", () => {
		expect(parseRetryAfterMs("2", now)).toBe(2000);
		expect(parseRetryAfterMs("Sun, 18 Oct 2026 12:00:30 GMT", now)).toBe(30000);
		expect(parseRetryAfterMs("Sun, 18 Oct 2026 11:59:00 GMT", now)).toBe(0);
		expect(parseRetryAfterMs("soon", now)).toBeUndefined();
		expect(parseRetryAfterMs(null, now)).toBeUndefined();
	});
});

describe("languageCode", () => {
	it("maps Whisper language names to codes, ignoring case and surrounding space", () => {
		expect(languageCode("english")).toBe("en");
		expect(languageCode(" German ")).toBe("de");
		expect(languageCode("Haitian Creole")).toBe("ht");
		expect(languageCode("cantonese")).toBe("yue");
		expect(languageCode("javanese")).toBe("jv");
	});

	it("throws for names Whisper does not produce, including object prototype keys", () => {
		expect(() => languageCode("klingon")).toThrow(UnknownLanguageError);
		expect(() => languageCode("constructor")).toThrow(UnknownLanguageError);
	});

	it("exposes the code list and the name for a code", () => {
		expect(LANGUAGE_CODES.has("es")).toBe(true);
		expect(LANGUAGE_CODES.has("klingon")).toBe(false);
		expect(languageName("es")).toBe("spanish");
		expect(languageName("zz")).toBeUndefined();
	});
});

describe("UsageMeter", () => {
	it("sums audio seconds and keeps every LLM call, and reports nothing when unused", () => {
		const meter = new UsageMeter();
		expect(meter.snapshot()).toEqual({});

		meter.recordAudio(1.5);
		meter.recordAudio(2);
		meter.recordLlm({ model: "gpt-6-luna", inputTokens: 3, outputTokens: 1 });

		expect(meter.snapshot()).toEqual({
			audioSec: 3.5,
			llm: [{ model: "gpt-6-luna", inputTokens: 3, outputTokens: 1 }]
		});
	});
});
