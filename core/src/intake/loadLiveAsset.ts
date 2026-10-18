import { NotFoundError, UnprocessableError, type Preset } from "@helios/contracts";
import { mediaAssets, type Account, type EncodingPreset, type MediaAsset } from "../models";
import { resolvePreset } from "../presetAdmin";

export async function loadAssetRecord(accountId: string, assetId: string): Promise<MediaAsset> {
	const asset = await mediaAssets().findOne({ _id: assetId, accountId });
	if (asset === null) {
		throw new NotFoundError(`Asset ${assetId} not found`);
	}
	return asset;
}

export async function loadLiveAsset(account: Account, assetId: string): Promise<MediaAsset> {
	const asset = await loadAssetRecord(account._id, assetId);
	if (asset.deletedAt !== undefined) {
		throw new NotFoundError(`Asset ${assetId} not found`);
	}
	return asset;
}

export function snapshotOf(asset: MediaAsset): Preset {
	if (asset.presetSnapshot === undefined) {
		throw new UnprocessableError("Asset has not been encoded yet", undefined, "asset_not_encoded");
	}
	return asset.presetSnapshot;
}

export async function currentPresetOf(account: Account, asset: MediaAsset): Promise<Preset> {
	if (asset.presetName === undefined) {
		throw new UnprocessableError("Asset has not been encoded yet", undefined, "asset_not_encoded");
	}
	return toPreset(await resolvePreset(account._id, asset.presetName));
}

export function toPreset(record: EncodingPreset): Preset {
	const { _id, accountId, createdAt, updatedAt, ...preset } = record;
	return preset;
}
