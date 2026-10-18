import { NotFoundError } from "@helios/contracts";
import { mediaAssets, requests, type PipelineRequest } from "../models";
import { cancelRequest } from "./cancelRequest";
import { createRequest } from "./createRequest";
import { OPEN_REQUEST_STATUSES } from "./types";

export async function requestPurge(accountId: string, assetId: string): Promise<PipelineRequest> {
	const asset = await mediaAssets().findOne({ _id: assetId, accountId });
	if (asset === null) {
		throw new NotFoundError(`Asset ${assetId} not found`);
	}
	await mediaAssets().updateOne(
		{ _id: assetId, accountId, deletedAt: { $exists: false } },
		{ $set: { deletedAt: new Date() } }
	);
	await cancelInFlight(accountId, assetId);
	const { request } = await createRequest({
		requestId: `purge:${assetId}`,
		asset,
		mode: "purge",
		analyze: "async"
	});
	return request;
}

async function cancelInFlight(accountId: string, assetId: string): Promise<void> {
	const inFlight = await requests()
		.find(
			{ accountId, assetId, mode: { $ne: "purge" }, status: { $in: [...OPEN_REQUEST_STATUSES] } },
			{ projection: { _id: 1 } }
		)
		.toArray();
	for (const { _id } of inFlight) {
		await cancelRequest(accountId, _id);
	}
}
