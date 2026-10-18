import type { RequestError } from "@helios/contracts";
import { config } from "../config";
import { sourceObjectLocation } from "../assets";
import { ingestUrl } from "../ingest";
import { mediaAssets, accounts, type MediaAsset, type PipelineRequest } from "../models";
import { failRequest, launchRequest, loadRequest } from "../pipeline";
import { ResponseTooLargeError, UnprocessableSourceError, UnsafeUrlError } from "../ssrf";
import { objectStore } from "../storage";
import { analyzeConfig } from "./config";
import { probeSource } from "./probe";

export async function analyzeRequest(requestId: string): Promise<PipelineRequest> {
	const request = await loadRequest(requestId);
	if (request.status !== "ANALYZING") {
		return request;
	}
	const asset = await mediaAssets().findOne({ _id: request.assetId, accountId: request.accountId });
	if (asset === null) {
		throw new Error(`Asset ${request.assetId} not found for account ${request.accountId}`);
	}
	if (asset.sourceMetadata === undefined) {
		const failure = await analyzeSource(asset);
		if (failure !== undefined) {
			await failRequest(requestId, failure);
			return loadRequest(requestId);
		}
	}
	return launchRequest(requestId);
}

export async function failAnalyze(requestId: string): Promise<void> {
	await failRequest(requestId, { code: "analyze_failed", message: "Source analysis failed after retries" });
}

async function analyzeSource(asset: MediaAsset): Promise<RequestError | undefined> {
	try {
		const { bucket, key } = await sourceLocation(asset);
		const url = await objectStore().presignGet(bucket, key, analyzeConfig().SOURCE_URL_TTL_SEC);
		const sourceMetadata = await probeSource(url);
		await mediaAssets().updateOne({ _id: asset._id, accountId: asset.accountId }, { $set: { sourceMetadata } });
		return undefined;
	} catch (err) {
		if (isSourceFailure(err)) {
			return { code: err.code, message: err.message };
		}
		throw err;
	}
}

async function sourceLocation(asset: MediaAsset): Promise<{ bucket: string; key: string }> {
	if (asset.source.type !== "url") {
		return sourceObjectLocation(asset);
	}
	const key = await ingestUrl(asset, await accountSlug(asset.accountId), {
		maxBytes: analyzeConfig().MAX_INGEST_BYTES
	});
	return { bucket: config().MEDIA_BUCKET, key };
}

async function accountSlug(accountId: string): Promise<string> {
	const account = await accounts().findOne({ _id: accountId });
	if (account === null) {
		throw new Error(`Account ${accountId} not found`);
	}
	return account.slug;
}

function isSourceFailure(err: unknown): err is UnsafeUrlError | ResponseTooLargeError | UnprocessableSourceError {
	return (
		err instanceof UnsafeUrlError || err instanceof ResponseTooLargeError || err instanceof UnprocessableSourceError
	);
}
