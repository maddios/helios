import type { FetchFn } from "../../src/options.js";

/** One request observed by a fake fetch. */
export interface Call {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: unknown;
	raw: Uint8Array | string | undefined;
	signal: AbortSignal | undefined;
}

/** Answers one request: a response, a network failure, or a function that decides at call time. */
export type Responder = Response | Error | ((call: Call) => Response | Promise<Response>);

/** A fetch stub that answers requests in order, plus the requests it saw. */
export interface ScriptedFetch {
	fetch: FetchFn;
	calls: Call[];
}

/**
 * Builds a fetch that answers each request with the next responder. Fails the test if it runs out of responders.
 *
 * @param responders Responders in call order.
 * @returns The fetch stub and its recorded calls.
 */
export function scriptedFetch(responders: Responder[]): ScriptedFetch {
	const calls: Call[] = [];
	const fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const call = toCall(String(url), init);
		calls.push(call);
		const responder = responders.shift();
		if (responder === undefined) {
			throw new Error(`unexpected request ${call.method} ${call.url}`);
		}
		return responder instanceof Error || responder instanceof Response
			? respondWith(responder)
			: respondWith(await responder(call));
	}) as FetchFn;
	return { fetch, calls };
}

/**
 * Builds a fetch that routes each request by method and URL.
 *
 * @param handler Returns the response for a call.
 * @returns The fetch stub and its recorded calls.
 */
export function routedFetch(handler: (call: Call) => Response | Promise<Response>): ScriptedFetch {
	const calls: Call[] = [];
	const fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const call = toCall(String(url), init);
		calls.push(call);
		return respondWith(await handler(call));
	}) as FetchFn;
	return { fetch, calls };
}

/**
 * Builds a JSON response.
 *
 * @param status HTTP status.
 * @param body JSON body; omitted for empty responses.
 * @param headers Extra response headers.
 * @returns The response.
 */
export function json(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers }
	});
}

/**
 * Builds an API error response in the envelope the server uses.
 *
 * @param status HTTP status.
 * @param code Machine-readable error code.
 * @param requestId Optional request id in the body.
 * @returns The response.
 */
export function apiError(status: number, code: string, requestId?: string): Response {
	return json(status, { error: { code, message: `${code} happened`, requestId } });
}

/**
 * Reads a request's body as text.
 *
 * @param call The recorded call.
 * @returns The body text, or `undefined` when the call had no body.
 */
export function bodyText(call: Call): string | undefined {
	if (call.raw === undefined) {
		return undefined;
	}
	return typeof call.raw === "string" ? call.raw : Buffer.from(call.raw).toString("utf8");
}

function toCall(url: string, init: RequestInit | undefined): Call {
	const headers = Object.fromEntries(new Headers(init?.headers).entries());
	const raw = typeof init?.body === "string" || init?.body instanceof Uint8Array ? init.body : undefined;
	return {
		method: init?.method ?? "GET",
		url,
		headers,
		body: typeof raw === "string" ? parseJson(raw) : undefined,
		raw,
		signal: init?.signal ?? undefined
	};
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function respondWith(responder: Response | Error): Response {
	if (responder instanceof Error) {
		throw responder;
	}
	return responder;
}
