import { pipelineItems, type PipelineItem } from "../models";
import { enqueueItems } from "./enqueueItems";

export async function releaseDependent(dependent: PipelineItem): Promise<void> {
	if (dependent.pendingDeps.length > 0) {
		return;
	}
	await enqueueItems([dependent]);
	await pipelineItems().updateOne(
		{ _id: dependent._id, status: "BLOCKED", pendingDeps: { $size: 0 } },
		{ $set: { status: "QUEUED" } }
	);
}
