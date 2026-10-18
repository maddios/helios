import { randomUUID } from "node:crypto";
import { ForbiddenError, UnprocessableError, type EncodeSource } from "@helios/contracts";
import { config } from "../config";
import { insertAsset } from "../assets";
import type { Account, MediaAsset, MediaAssetSource } from "../models";
import { objectStore } from "../storage";
import { assertOwnedUploadKey } from "../uploads";

export async function toAssetSource(account: Account, source: EncodeSource): Promise<MediaAssetSource> {
	if ("url" in source) {
		return { type: "url", url: source.url };
	}
	if ("uploadKey" in source) {
		assertOwnedUploadKey(account.slug, source.uploadKey);
		await assertSourceExists(config().MEDIA_BUCKET, source.uploadKey);
		return { type: "upload", key: source.uploadKey };
	}
	if (source.bucket === config().MEDIA_BUCKET || !account.sourceBuckets.includes(source.bucket)) {
		throw new ForbiddenError("Source bucket is not allowed for this account");
	}
	await assertSourceExists(source.bucket, source.key);
	return { type: "s3", bucket: source.bucket, key: source.key };
}

export async function createAsset(
	account: Account,
	source: MediaAssetSource,
	externalId?: string
): Promise<MediaAsset> {
	const now = new Date();
	const asset: MediaAsset = {
		_id: randomUUID(),
		accountId: account._id,
		...(externalId !== undefined && { externalId }),
		source,
		version: 1,
		outputs: {},
		createdAt: now,
		updatedAt: now
	};
	await insertAsset(asset);
	return asset;
}

async function assertSourceExists(bucket: string, key: string): Promise<void> {
	if (!(await objectStore().headObject(bucket, key))) {
		throw new UnprocessableError("Source object does not exist", undefined, "source_not_found");
	}
}
