import { resizeCachePrefix, assetPrefix } from "../assets";
import { enqueueInvalidation, prefixPath } from "../cdn";
import { accounts, type PipelineRequest } from "../models";
import { objectStore } from "../storage";

export async function refreshReencodedAsset(request: PipelineRequest): Promise<void> {
	const account = await accounts().findOne({ _id: request.accountId });
	if (account === null) {
		throw new Error(`Account ${request.accountId} not found for request ${request._id}`);
	}
	const store = objectStore();
	await store.deleteKeys(await store.listKeys(resizeCachePrefix(account.slug, request.assetId)));
	await enqueueInvalidation([prefixPath(assetPrefix(account.slug, request.assetId))], `${request._id}:reencode`);
}
