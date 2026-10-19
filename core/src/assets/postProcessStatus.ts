import { isOptionalKind, OPTIONAL_ITEM_KINDS, type PostProcessStatus } from "@helios/contracts";
import { pipelineItems } from "../models";

export async function postProcessStatusOf(
	accountId: string,
	assetIds: string[]
): Promise<Map<string, PostProcessStatus>> {
	const statuses = new Map<string, PostProcessStatus>(assetIds.map((assetId) => [assetId, {}]));
	const items = await pipelineItems()
		.find({ accountId, assetId: { $in: assetIds }, kind: { $in: [...OPTIONAL_ITEM_KINDS] } })
		.sort({ createdAt: -1 })
		.toArray();
	for (const item of items) {
		const status = statuses.get(item.assetId);
		if (status !== undefined && isOptionalKind(item.kind) && status[item.kind] === undefined) {
			status[item.kind] = item.status;
		}
	}
	return statuses;
}
