import { pipelineItems, type PipelineItem } from "../models";
import { queueFor } from "../queue";
import { itemMessage } from "./itemMessage";
import type { ItemMessage } from "./types";

export async function releaseDependent(dependent: PipelineItem): Promise<void> {
	if (dependent.pendingDeps.length > 0) {
		return;
	}
	await queueFor<ItemMessage>(dependent.queue).send(itemMessage(dependent));
	await pipelineItems().updateOne(
		{ _id: dependent._id, status: "BLOCKED", pendingDeps: { $size: 0 } },
		{ $set: { status: "QUEUED" } }
	);
}
