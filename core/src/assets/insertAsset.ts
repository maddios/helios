import { mediaAssets, type MediaAsset } from "../models";

export async function insertAsset(asset: MediaAsset): Promise<void> {
	await mediaAssets().insertOne(asset);
}
