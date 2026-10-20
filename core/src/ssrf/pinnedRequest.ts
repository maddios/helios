import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import type { ResolvedUrl } from "./assertPublicUrl";

const MS_PER_SEC = 1000;

export interface PinnedRequestOptions {
	method: "GET" | "POST";
	timeoutSec: number;
	headers?: OutgoingHttpHeaders;
	body?: string;
	signal?: AbortSignal;
}

export function pinnedRequest(target: ResolvedUrl, options: PinnedRequestOptions): Promise<IncomingMessage> {
	const timeoutMs = options.timeoutSec * MS_PER_SEC;
	return new Promise((resolve, reject) => {
		const requestOptions = {
			agent: false,
			lookup: pinnedLookup(target),
			method: options.method,
			headers: options.headers,
			signal: options.signal
		};
		const request =
			target.url.protocol === "https:"
				? httpsRequest(target.url, requestOptions, onResponse)
				: httpRequest(target.url, requestOptions, onResponse);
		const timer = setTimeout(
			() => request.destroy(new Error(`No response within ${timeoutMs / MS_PER_SEC} seconds`)),
			timeoutMs
		);
		function onResponse(response: IncomingMessage): void {
			clearTimeout(timer);
			resolve(response);
		}
		request.setTimeout(timeoutMs, () => request.destroy(new Error("Connection idle timeout")));
		request.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		request.end(options.body);
	});
}

function pinnedLookup(target: ResolvedUrl): LookupFunction {
	return (_hostname, options, callback) => {
		if (options.all) {
			callback(null, [{ address: target.address, family: target.family }]);
			return;
		}
		callback(null, target.address, target.family);
	};
}
