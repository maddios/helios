import {
	assertNoRunningItems,
	assetPrefix,
	ingestPrefix,
	objectStore,
	pipelineItems,
	sceneAnalyses,
	scrubAssetRecord,
	scrubCallbackPayloads,
	transcripts
} from "@helios/core";
import { config } from "../config";
import type { HandlerContext, HandlerResult } from "./types";

export async function purgeHandler({ asset, slug, request }: HandlerContext): Promise<HandlerResult> {
	await assertNoRunningItems(asset, config().LEASE_SEC, request._id);
	const store = objectStore();
	const prefixes = [assetPrefix(slug, asset._id), ingestPrefix(slug, asset._id)];
	const keys = (await Promise.all(prefixes.map((prefix) => store.listKeys(prefix)))).flat();
	if (asset.source.type === "upload") {
		keys.push(asset.source.key);
	}
	await store.deleteKeys(keys);
	await scrubAssetRecord(asset);
	await scrubCallbackPayloads(asset.accountId, asset._id);
	const scope = { accountId: asset.accountId, assetId: asset._id };
	await transcripts().deleteMany(scope);
	await sceneAnalyses().deleteMany(scope);
	await pipelineItems().deleteMany({ ...scope, requestId: { $ne: request._id } });
	return { output: {}, outputBytes: 0 };
}
