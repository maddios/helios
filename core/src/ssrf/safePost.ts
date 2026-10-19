import type { OutgoingHttpHeaders } from "node:http";
import { assertPublicUrl, type Resolver } from "./assertPublicUrl";
import { pinnedRequest } from "./pinnedRequest";

export type SafePostOptions = { body: string; headers: OutgoingHttpHeaders; timeoutSec: number; resolve?: Resolver };
export type SafePostResponse = { status: number };

export async function safePost(input: string, options: SafePostOptions): Promise<SafePostResponse> {
	const target = await assertPublicUrl(input, { resolve: options.resolve });
	const response = await pinnedRequest(target, {
		method: "POST",
		timeoutSec: options.timeoutSec,
		headers: { ...options.headers, "content-length": Buffer.byteLength(options.body) },
		body: options.body
	});
	response.destroy();
	return { status: response.statusCode ?? 0 };
}
