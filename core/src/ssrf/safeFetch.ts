import type { IncomingMessage } from "node:http";
import { pipeline, type Readable } from "node:stream";
import { assertPublicUrl, parseUrl, type ResolvedUrl, type Resolver } from "./assertPublicUrl";
import { byteCap } from "./byteCap";
import { ResponseTooLargeError, UnprocessableSourceError } from "./errors";
import { config } from "../config";
import { pinnedRequest } from "./pinnedRequest";

export type SafeFetchOptions = { maxBytes: number; maxRedirects: number; resolve?: Resolver };
export type SafeFetchResponse = { contentType?: string; contentLength?: number; body: Readable };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function safeFetch(input: string, options: SafeFetchOptions): Promise<SafeFetchResponse> {
	const start = await assertPublicUrl(input, { resolve: options.resolve });
	const response = await fetchFollowingRedirects(start, options);
	return toResponse(response, options.maxBytes);
}

async function fetchFollowingRedirects(start: ResolvedUrl, options: SafeFetchOptions): Promise<IncomingMessage> {
	let target = start;
	for (let redirects = 0; ; redirects++) {
		const response = await fetchPinned(target);
		const location = redirectLocation(response);
		if (location === undefined) {
			return response;
		}
		response.destroy();
		if (redirects >= options.maxRedirects) {
			throw new UnprocessableSourceError(`Too many redirects (max ${options.maxRedirects})`);
		}
		const next = parseUrl(location, target.url);
		target = await assertPublicUrl(next.toString(), { resolve: options.resolve });
	}
}

async function fetchPinned(target: ResolvedUrl): Promise<IncomingMessage> {
	try {
		return await pinnedRequest(target, { method: "GET", timeoutSec: config().INGEST_TIMEOUT_SEC });
	} catch (err) {
		throw new UnprocessableSourceError(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function redirectLocation(response: IncomingMessage): string | undefined {
	const status = response.statusCode ?? 0;
	return REDIRECT_STATUSES.has(status) ? response.headers.location : undefined;
}

function toResponse(response: IncomingMessage, maxBytes: number): SafeFetchResponse {
	const status = response.statusCode ?? 0;
	if (status < 200 || status > 299) {
		response.destroy();
		throw new UnprocessableSourceError(`Fetch failed with status ${status}`);
	}
	const header = response.headers["content-length"];
	const contentLength = header === undefined ? undefined : Number(header);
	if (contentLength !== undefined && contentLength > maxBytes) {
		response.destroy();
		throw new ResponseTooLargeError(maxBytes);
	}
	const body = byteCap(maxBytes);
	pipeline(response, body, () => undefined);
	return { contentType: response.headers["content-type"], contentLength, body };
}
