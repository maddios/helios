import { NotFoundError } from "@helios/contracts";
import { mediaAssets, type MediaAsset } from "../models";

export async function findLiveAsset(accountId: string, assetId: string): Promise<MediaAsset> {
	const asset = await mediaAssets().findOne({ _id: assetId, accountId, deletedAt: { $exists: false } });
	if (asset === null) {
		throw new NotFoundError(`Asset ${assetId} not found`);
	}
	return asset;
}
