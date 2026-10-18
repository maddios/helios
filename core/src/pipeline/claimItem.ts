import { randomUUID } from "node:crypto";
import { pipelineItems, requests, type PipelineItem, type PipelineRequest } from "../models";
import { completeItem } from "./completeItem";
import { isTerminal, type TerminalStatus } from "./types";

const MS_PER_SEC = 1000;

export type ClaimResult =
	| { claimed: true; item: PipelineItem; request: PipelineRequest; leaseId: string }
	| { claimed: false; reason: "not-claimable" | "cancelled" }
	| { claimed: false; reason: "busy"; messageId: string }
	| { claimed: false; reason: "terminal"; status: TerminalStatus };

const NOT_CLAIMABLE: ClaimResult = { claimed: false, reason: "not-claimable" };

export async function claimItem(itemId: string, messageId: string, leaseSec: number): Promise<ClaimResult> {
	const current = await pipelineItems().findOne({ _id: itemId });
	if (current === null) {
		return NOT_CLAIMABLE;
	}
	const request = await requests().findOne({ _id: current.requestId });
	if (request === null) {
		throw new Error(`Request ${current.requestId} not found for item ${itemId}`);
	}
	if (isTerminal(current.status)) {
		return { claimed: false, reason: "terminal", status: current.status };
	}
	if (request.status === "CANCELLED") {
		await completeItem({ itemId, status: "CANCELLED" });
		return { claimed: false, reason: "cancelled" };
	}
	const now = new Date();
	const leaseId = randomUUID();
	const item = await pipelineItems().findOneAndUpdate(
		{
			_id: itemId,
			$or: [
				{ status: "QUEUED" },
				{ status: "BLOCKED", pendingDeps: { $size: 0 } },
				{ status: "IN_PROGRESS", heartbeatAt: { $lt: new Date(now.getTime() - leaseSec * MS_PER_SEC) } }
			]
		},
		{
			$set: { status: "IN_PROGRESS", messageId, leaseId, heartbeatAt: now },
			$min: { startedAt: now },
			$inc: { attempts: 1 }
		},
		{ returnDocument: "after" }
	);
	if (item !== null) {
		return { claimed: true, item, request, leaseId };
	}
	if (current.status === "IN_PROGRESS" && current.messageId !== undefined) {
		return { claimed: false, reason: "busy", messageId: current.messageId };
	}
	return NOT_CLAIMABLE;
}
