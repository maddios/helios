import type { RequestItemView, RequestView } from "@helios/contracts";
import type { PipelineItem, PipelineRequest } from "../models";
import { isTerminal, loadItems } from "../pipeline";

export async function toRequestView(request: PipelineRequest): Promise<RequestView> {
	const items = (await loadItems(request._id)).map(toItemView);
	const finished = items.filter((item) => isTerminal(item.status)).length;
	return {
		id: request._id,
		assetId: request.assetId,
		mode: request.mode,
		status: request.status,
		...(request.clientRequestId !== request._id && { clientRequestId: request.clientRequestId }),
		...(request.postProcess !== undefined && { postProcess: request.postProcess }),
		assetVersion: request.assetVersion,
		items,
		progress: { total: items.length, finished, pending: items.length - finished },
		...(request.error !== undefined && { error: request.error }),
		createdAt: request.createdAt.toISOString(),
		...(request.completedAt !== undefined && { completedAt: request.completedAt.toISOString() })
	};
}

export function toItemView(item: PipelineItem): RequestItemView {
	return {
		id: item._id,
		key: item.key,
		kind: item.kind,
		...(item.profile !== undefined && { profile: item.profile }),
		queue: item.queue,
		priority: item.priority,
		status: item.status,
		...(item.error !== undefined && { error: item.error }),
		...(item.completedAt !== undefined && { completedAt: item.completedAt.toISOString() })
	};
}
