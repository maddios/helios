import { mediaAssets } from "@helios/core";
import type { HandlerContext } from "./types";

export class SupersededError extends Error {
	constructor(assetVersion: number) {
		super(`superseded by asset version ${assetVersion}`);
		this.name = "SupersededError";
	}
}

export class AssetDeletedError extends Error {
	constructor() {
		super("asset deleted");
		this.name = "AssetDeletedError";
	}
}

export async function assertCurrent({ asset, request }: HandlerContext): Promise<void> {
	const current = await mediaAssets().findOne(
		{ _id: asset._id, accountId: asset.accountId },
		{ projection: { version: 1, deletedAt: 1 } }
	);
	if (current === null) {
		throw new Error(`Asset ${asset._id} not found for account ${asset.accountId}`);
	}
	if (current.deletedAt !== undefined) {
		throw new AssetDeletedError();
	}
	if (current.version > request.assetVersion) {
		throw new SupersededError(current.version);
	}
}
