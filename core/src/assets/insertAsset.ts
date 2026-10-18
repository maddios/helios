import { ConflictError } from "@helios/contracts";
import { isDuplicateKeyError } from "../db";
import { mediaAssets, type MediaAsset } from "../models";

export async function insertAsset(asset: MediaAsset): Promise<void> {
	try {
		await mediaAssets().insertOne(asset);
	} catch (err) {
		if (isDuplicateKeyError(err)) {
			throw new ConflictError("Upload is already bound to another asset");
		}
		throw err;
	}
}
