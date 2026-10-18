import type { ItemKind, PostProcessStatus } from "@helios/contracts";
import { pipelineItems } from "../models";

type PostProcessKind = keyof PostProcessStatus;

function isPostProcessKind(kind: ItemKind): kind is PostProcessKind {
	return kind === "transcribe" || kind === "scenes";
}

export async function postProcessStatusOf(
	accountId: string,
	assetIds: string[]
): Promise<Map<string, PostProcessStatus>> {
	const statuses = new Map<string, PostProcessStatus>(assetIds.map((assetId) => [assetId, {}]));
	const items = await pipelineItems()
		.find({ accountId, assetId: { $in: assetIds }, kind: { $in: ["transcribe", "scenes"] } })
		.sort({ createdAt: -1 })
		.toArray();
	for (const item of items) {
		const status = statuses.get(item.assetId);
		if (status !== undefined && isPostProcessKind(item.kind) && status[item.kind] === undefined) {
			status[item.kind] = item.status;
		}
	}
	return statuses;
}
