import { callbackDeliveries, mediaAssets, pipelineItems, requests, type MediaAsset } from "../models";

export async function assertNoRunningItems(asset: MediaAsset, leaseSec: number, purgeRequestId: string): Promise<void> {
	const freshSince = new Date(Date.now() - leaseSec * 1000);
	const running = await pipelineItems().countDocuments({
		assetId: asset._id,
		accountId: asset.accountId,
		requestId: { $ne: purgeRequestId },
		status: "IN_PROGRESS",
		heartbeatAt: { $gte: freshSince }
	});
	if (running > 0) {
		throw new Error(`Asset ${asset._id} has ${running} item(s) still running; retrying the purge`);
	}
}

export async function scrubAssetRecord(asset: MediaAsset): Promise<void> {
	await mediaAssets().updateOne(
		{ _id: asset._id, accountId: asset.accountId },
		{
			$unset: {
				outputs: "",
				activeStill: "",
				externalId: "",
				"sourceMetadata.probe": "",
				"source.url": ""
			},
			$set: { updatedAt: new Date() }
		}
	);
}

export async function scrubCallbackPayloads(accountId: string, assetId: string): Promise<void> {
	const requestIds = await requests().distinct("_id", { accountId, assetId });
	await callbackDeliveries().updateMany({ accountId, requestId: { $in: requestIds } }, { $set: { payload: {} } });
}
