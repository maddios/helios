import type { Usage } from "@helios/contracts";
import { pipelineItems } from "../models";

export async function renewLease(itemId: string, leaseId: string, progress?: number): Promise<boolean> {
	const result = await pipelineItems().updateOne(
		{ _id: itemId, status: "IN_PROGRESS", leaseId },
		{ $set: { heartbeatAt: new Date(), ...(progress !== undefined && { progress }) } }
	);
	return result.matchedCount === 1;
}

export async function releaseLease(itemId: string, leaseId: string, usage?: Usage): Promise<void> {
	await pipelineItems().updateOne(
		{ _id: itemId, status: "IN_PROGRESS", leaseId },
		{
			$set: { status: "QUEUED" },
			$unset: { leaseId: "", heartbeatAt: "" },
			$inc: { attempts: -1 },
			...(usage !== undefined && { $push: { usage } })
		}
	);
}
