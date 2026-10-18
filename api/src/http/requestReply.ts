import { UnprocessableError, type AnalyzeMode, type RequestView } from "@helios/contracts";
import type { CreateRequestResult } from "@helios/core";
import { toRequestView } from "../views/request";
import { reply, type Reply } from "./reply";

const SYNC_FAILURE_CODES = new Set([
	"unprocessable_source",
	"nothing_to_do",
	"unsafe_url",
	"too_large",
	"source_not_found"
]);

export async function requestReply(
	{ request, created }: CreateRequestResult,
	analyze: AnalyzeMode,
	wrap: (view: RequestView) => unknown = (view) => view
): Promise<Reply> {
	const view = await toRequestView(request);
	if (!created) {
		return reply.ok(wrap(view));
	}
	if (request.error !== undefined && SYNC_FAILURE_CODES.has(request.error.code)) {
		throw new UnprocessableError(
			request.error.message,
			{ requestId: request._id, assetId: request.assetId },
			request.error.code
		);
	}
	return analyze === "async" ? reply.accepted(wrap(view)) : reply.created(wrap(view));
}
