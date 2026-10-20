import {
	assertNoRunningItems,
	assetPrefix,
	enqueueInvalidation,
	ingestPrefix,
	objectStore,
	pipelineItems,
	prefixPath,
	resizeCachePrefix,
	sceneAnalyses,
	scrubAssetRecord,
	scrubCallbackPayloads,
	transcripts
} from "@helios/core";
import { config } from "../config";
import type { HandlerContext, HandlerResult } from "./types";

export async function purgeHandler({ asset, account, request }: HandlerContext): Promise<HandlerResult> {
	await assertNoRunningItems(asset, config().LEASE_SEC, request._id);
	const store = objectStore();
	const originals = (
		await Promise.all(
			[assetPrefix(account.slug, asset._id), ingestPrefix(account.slug, asset._id)].map((prefix) =>
				store.listKeys(prefix)
			)
		)
	).flat();
	// Originals first: a render that re-caches after the listing sees its original gone and removes its variant.
	await store.deleteKeys(originals);
	await store.deleteKeys(await store.listKeys(resizeCachePrefix(account.slug, asset._id)));
	await enqueueInvalidation([prefixPath(assetPrefix(account.slug, asset._id))], `${request._id}:purge`);
	await scrubAssetRecord(asset);
	await scrubCallbackPayloads(asset.accountId, asset._id);
	const scope = { accountId: asset.accountId, assetId: asset._id };
	await transcripts().deleteMany(scope);
	await sceneAnalyses().deleteMany(scope);
	await pipelineItems().deleteMany({ ...scope, requestId: { $ne: request._id } });
	return { output: {}, outputBytes: 0 };
}
