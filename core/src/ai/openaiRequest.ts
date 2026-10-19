import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { aiConfig } from "./config";
import { OpenAIError } from "./errors";

const BASE_BACKOFF_MS = 500;
const NETWORK_CODE = /^(ECONNRESET|ETIMEDOUT|UND_ERR_[A-Z_]+)$/;

const ErrorBodySchema = z.object({
	error: z.object({ code: z.string().nullish() }).optional()
});

export interface OpenAIRequest {
	path: string;
	body: FormData | object;
	timeoutSec: number;
	signal: AbortSignal;
}

export async function openaiRequest(request: OpenAIRequest): Promise<unknown> {
	const { OPENAI_MAX_ATTEMPTS, OPENAI_MAX_RETRY_AFTER_SEC } = aiConfig();
	for (let attempt = 1; ; attempt++) {
		try {
			return await postOnce(request);
		} catch (err) {
			if (request.signal.aborted || !isRetryable(err) || attempt >= OPENAI_MAX_ATTEMPTS) {
				throw err;
			}
			await sleep(backoffMs(err, attempt, OPENAI_MAX_RETRY_AFTER_SEC * 1000), undefined, {
				signal: request.signal
			});
		}
	}
}

async function postOnce({ path, body, timeoutSec, signal }: OpenAIRequest): Promise<unknown> {
	const { OPENAI_BASE_URL, OPENAI_API_KEY } = aiConfig();
	const json = !(body instanceof FormData);
	const headers: Record<string, string> = { Authorization: `Bearer ${OPENAI_API_KEY}` };
	if (json) {
		headers["Content-Type"] = "application/json";
	}
	const response = await send(
		`${OPENAI_BASE_URL}${path}`,
		{
			method: "POST",
			headers,
			body: json ? JSON.stringify(body) : body,
			signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutSec * 1000)])
		},
		signal
	);
	if (!response.ok) {
		throw await toApiError(response);
	}
	return response.json();
}

async function send(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (err) {
		if (signal.aborted) {
			throw err;
		}
		if (fieldOf(err, "name") === "TimeoutError") {
			throw new OpenAIError({ code: "timeout" });
		}
		if (isNetworkFailure(err)) {
			throw new OpenAIError({ code: "network" });
		}
		throw err;
	}
}

async function toApiError(response: Response): Promise<OpenAIError> {
	const parsed = ErrorBodySchema.safeParse(await response.json().catch(() => undefined));
	return new OpenAIError({
		status: response.status,
		code: parsed.data?.error?.code ?? "unknown",
		retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after"), Date.now())
	});
}

export function parseRetryAfterMs(header: string | null, now: number): number | undefined {
	if (header === null) {
		return undefined;
	}
	const seconds = Number(header);
	if (Number.isFinite(seconds)) {
		return Math.max(0, seconds * 1000);
	}
	const at = Date.parse(header);
	return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function isNetworkFailure(err: unknown): boolean {
	const code = fieldOf(fieldOf(err, "cause"), "code");
	return fieldOf(err, "message") === "fetch failed" || (typeof code === "string" && NETWORK_CODE.test(code));
}

function fieldOf(value: unknown, field: string): unknown {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[field] : undefined;
}

function isRetryable(err: unknown): err is OpenAIError {
	return (
		err instanceof OpenAIError &&
		(err.code === "timeout" || err.code === "network" || err.status === 429 || (err.status ?? 0) >= 500)
	);
}

function backoffMs(err: OpenAIError, attempt: number, maxMs: number): number {
	return Math.min(err.retryAfterMs ?? BASE_BACKOFF_MS * 2 ** (attempt - 1), maxMs);
}
