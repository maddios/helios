import { ConflictError, NotFoundError } from "@helios/contracts";
import { jobReports, pipelineItems, requests, type PipelineRequest } from "../models";
import { completeItem } from "./completeItem";
import { finalizeRequest } from "./finalizeRequest";
import { loadRequest } from "./loadRequest";
import { isOpenRequest, OPEN_REQUEST_STATUSES } from "./types";

export async function cancelRequest(accountId: string, requestId: string): Promise<PipelineRequest> {
	const request = await requests().findOne({ _id: requestId, accountId });
	if (request === null) {
		throw new NotFoundError(`Request ${requestId} not found`);
	}
	if (request.mode === "purge") {
		throw new ConflictError("Purge requests cannot be cancelled", undefined, "purge_not_cancellable");
	}
	const now = new Date();
	if (isOpenRequest(request.status)) {
		await requests().updateOne(
			{ _id: requestId, accountId, status: { $in: [...OPEN_REQUEST_STATUSES] } },
			{ $set: { status: "CANCELLED", completedAt: now } }
		);
	}
	const current = await loadRequest(requestId);
	if (current.status === "CANCELLED" && (await jobReports().countDocuments({ _id: requestId }, { limit: 1 })) === 0) {
		await settleUnstarted(requestId);
		await finalizeRequest(current, now, { status: "CANCELLED" });
	}
	return loadRequest(requestId);
}

async function settleUnstarted(requestId: string): Promise<void> {
	const unstarted = await pipelineItems()
		.find({ requestId, status: { $in: ["BLOCKED", "QUEUED"] } }, { projection: { _id: 1 } })
		.toArray();
	for (const { _id } of unstarted) {
		await completeItem({ itemId: _id, status: "CANCELLED" });
	}
}
