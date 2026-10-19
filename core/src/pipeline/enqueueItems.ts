import type { PipelineItem } from "../models";
import { isFargateQueue, queueFor } from "../queue";
import { notifyScaler } from "../scaler";
import { itemMessage } from "./itemMessage";
import type { ItemMessage } from "./types";

export async function enqueueItems(items: PipelineItem[]): Promise<void> {
	const queueNames = [...new Set(items.map((item) => item.queue))];
	await Promise.all(
		queueNames.map((name) =>
			queueFor<ItemMessage>(name).sendBatch(items.filter((item) => item.queue === name).map(itemMessage))
		)
	);
	if (queueNames.some(isFargateQueue)) {
		await notifyScaler();
	}
}
