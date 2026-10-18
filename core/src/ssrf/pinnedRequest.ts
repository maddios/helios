import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { config } from "../config";
import type { ResolvedUrl } from "./assertPublicUrl";

const MS_PER_SEC = 1000;

export function pinnedGet(target: ResolvedUrl): Promise<IncomingMessage> {
	const timeoutMs = config().INGEST_TIMEOUT_SEC * MS_PER_SEC;
	return new Promise((resolve, reject) => {
		const options = { agent: false, lookup: pinnedLookup(target) };
		const request =
			target.url.protocol === "https:"
				? httpsRequest(target.url, options, onResponse)
				: httpRequest(target.url, options, onResponse);
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
		request.end();
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
