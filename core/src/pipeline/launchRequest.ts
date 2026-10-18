import type { Preset, RequestError, ResolvedPostProcess, SourceMetadata } from "@helios/contracts";
import { config } from "../config";
import { mediaAssets, pipelineItems, requests, type MediaAsset, type PipelineRequest } from "../models";
import { enqueueItems } from "./enqueueItems";
import { failRequest } from "./failRequest";
import { buildItemDocs, insertItems, itemId } from "./launchItems";
import { loadRequest } from "./loadRequest";
import { planItems } from "./planItems";
import { isOpenRequest, OPEN_REQUEST_STATUSES, type PlannedItem } from "./types";

const NOTHING_TO_DO: RequestError = { code: "nothing_to_do", message: "Request has no work to do" };
const ASSET_DELETED: RequestError = { code: "asset_deleted", message: "Asset has been deleted" };

export async function launchRequest(requestId: string): Promise<PipelineRequest> {
	const request = await loadRequest(requestId);
	if (request.enqueuedAt !== undefined || !isOpenRequest(request.status)) {
		return request;
	}
	const asset = await loadAsset(request);
	if (request.mode !== "purge" && asset.deletedAt !== undefined) {
		await failRequest(requestId, ASSET_DELETED);
		return loadRequest(requestId);
	}
	const plan = planRequest(request, asset);
	if (plan.every((item) => item.status === "SKIPPED")) {
		await failRequest(requestId, NOTHING_TO_DO);
		return loadRequest(requestId);
	}
	const now = new Date();
	if (!(await setPendingItems(request._id, plan))) {
		return loadRequest(requestId);
	}
	await insertItems(buildItemDocs(request, plan, now));
	if (request.mode !== "postProcess" && request.mode !== "purge") {
		await updateAsset(request, requirePreset(request), now);
	}
	const queued = await pipelineItems().find({ requestId: request._id, status: "QUEUED" }).toArray();
	await enqueueItems(queued);
	return markEnqueued(request._id, now);
}

async function loadAsset(request: PipelineRequest): Promise<MediaAsset> {
	const asset = await mediaAssets().findOne({ _id: request.assetId, accountId: request.accountId });
	if (asset === null) {
		throw new Error(`Asset ${request.assetId} not found for account ${request.accountId}`);
	}
	return asset;
}

function planRequest(request: PipelineRequest, asset: MediaAsset): PlannedItem[] {
	if (request.mode === "purge") {
		return planItems({ mode: "purge" });
	}
	const { LAMBDA_MAX_DURATION_SEC, LAMBDA_MAX_SOURCE_BYTES } = config();
	return planItems({
		preset: requirePreset(request),
		source: requireSource(asset),
		postProcess: requirePostProcess(request),
		mode: request.mode,
		thresholds: { maxDurationSec: LAMBDA_MAX_DURATION_SEC, maxSourceBytes: LAMBDA_MAX_SOURCE_BYTES }
	});
}

function requirePreset(request: PipelineRequest): Preset {
	if (request.presetSnapshot === undefined) {
		throw new Error(`Request ${request._id} has no preset snapshot`);
	}
	return request.presetSnapshot;
}

function requirePostProcess(request: PipelineRequest): ResolvedPostProcess {
	if (request.postProcess === undefined) {
		throw new Error(`Request ${request._id} has no resolved postProcess`);
	}
	return request.postProcess;
}

function requireSource(asset: MediaAsset): SourceMetadata {
	if (asset.sourceMetadata === undefined) {
		throw new Error(`Asset ${asset._id} has no source metadata`);
	}
	return asset.sourceMetadata;
}

async function setPendingItems(requestId: string, plan: PlannedItem[]): Promise<boolean> {
	const pendingItems = plan.filter((item) => item.status !== "SKIPPED").map((item) => itemId(requestId, item.key));
	const result = await requests().updateOne(
		{ _id: requestId, status: { $in: [...OPEN_REQUEST_STATUSES] } },
		{ $set: { pendingItems } }
	);
	return result.matchedCount === 1;
}

async function updateAsset(request: PipelineRequest, preset: Preset, now: Date): Promise<void> {
	const result = await mediaAssets().updateOne(
		{ _id: request.assetId, accountId: request.accountId },
		{
			$max: { version: request.assetVersion },
			$set: { presetName: preset.name, presetVersion: preset.version, presetSnapshot: preset, updatedAt: now }
		}
	);
	if (result.matchedCount === 0) {
		throw new Error(`Asset ${request.assetId} not found for account ${request.accountId}`);
	}
}

async function markEnqueued(requestId: string, now: Date): Promise<PipelineRequest> {
	await requests().updateOne(
		{ _id: requestId, status: { $in: [...OPEN_REQUEST_STATUSES] } },
		{ $set: { enqueuedAt: now, status: "IN_PROGRESS" } }
	);
	return loadRequest(requestId);
}
