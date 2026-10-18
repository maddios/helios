import { config } from "../config";
import { toMessageAttributes } from "../logger";
import type { PipelineItem } from "../models";
import type { OutgoingMessage } from "../queue";
import type { ItemMessage } from "./types";

export function itemMessage(
	item: Pick<PipelineItem, "_id" | "requestId" | "accountId" | "assetId">
): OutgoingMessage<ItemMessage> {
	return {
		body: { itemId: item._id },
		...(config().SQS_FAIR_QUEUES && { groupId: item.accountId }),
		attributes: toMessageAttributes({
			accountId: item.accountId,
			requestId: item.requestId,
			itemId: item._id,
			assetId: item.assetId
		})
	};
}
