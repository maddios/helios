import type { Usage } from "@helios/contracts";
import { pipelineItems } from "../models";

export interface FailedAttemptInput {
	itemId: string;
	leaseId: string;
	usage: Usage;
	error: string;
}

export async function recordFailedAttempt({ itemId, leaseId, usage, error }: FailedAttemptInput): Promise<void> {
	await pipelineItems().updateOne(
		{ _id: itemId, status: "IN_PROGRESS", leaseId },
		{ $push: { usage }, $set: { error } }
	);
}
