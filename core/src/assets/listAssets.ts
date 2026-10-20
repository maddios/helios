import type { Filter } from "mongodb";
import { findPage, type PageInput } from "../pagination";
import { mediaAssets, type MediaAsset } from "../models";

export interface ListAssetsInput extends PageInput {
	externalId?: string;
}

export interface AssetPage {
	assets: MediaAsset[];
	nextCursor?: string;
}

export async function listAssets(accountId: string, input: ListAssetsInput): Promise<AssetPage> {
	const filter: Filter<MediaAsset> = {
		accountId,
		deletedAt: { $exists: false },
		...(input.externalId !== undefined && { externalId: input.externalId })
	};
	const page = await findPage(mediaAssets(), filter, input);
	return { assets: page.docs, ...(page.nextCursor !== undefined && { nextCursor: page.nextCursor }) };
}
