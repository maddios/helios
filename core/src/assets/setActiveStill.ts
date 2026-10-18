import { NotFoundError, type ActiveStill, type StillItem } from "@helios/contracts";
import { mediaAssets, type MediaAsset } from "../models";
import { AmbiguousStillsError, InvalidStillIndexError } from "./errors";

export async function setActiveStill(accountId: string, assetId: string, index: number): Promise<ActiveStill> {
	const asset = await mediaAssets().findOne({ _id: assetId, accountId, deletedAt: { $exists: false } });
	if (asset === null) {
		throw new NotFoundError(`Asset ${assetId} not found`);
	}
	const items = stillItems(asset);
	if (!Number.isInteger(index) || index < 0 || index >= items.length) {
		throw new InvalidStillIndexError(index, items.length);
	}
	const activeStill: ActiveStill = { index, timestampSec: items[index].timestampSec, selectedByUser: true };
	await mediaAssets().updateOne({ _id: assetId, accountId }, { $set: { activeStill, updatedAt: new Date() } });
	return activeStill;
}

function stillItems(asset: MediaAsset): StillItem[] {
	const outputs = Object.values(asset.outputs).filter(
		(output) => output.kind === "stills" && output.items !== undefined
	);
	if (outputs.length > 1) {
		throw new AmbiguousStillsError(asset._id, outputs.length);
	}
	return outputs[0]?.items ?? [];
}
