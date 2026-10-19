import type { Destination, ItemKind, ItemStatus, RequestMode, RequestStatus, ResourceUnits } from "@helios/contracts";
import { accounts, jobReports, mediaAssets, pipelineItems, requests, type PipelineItem } from "../../src/models";
import { genericPreset } from "../../src/presets";
import { isTerminal, type CallbackMessage } from "../../src/pipeline";
import { allPostProcess, asset } from "./pipelineFixtures";

export const SECRET = "whsec_test";
export const REQUEST_ID = "req-1";

const zeroUnits: ResourceUnits = {
	lambdaGbSeconds: 0,
	fargateVcpuSeconds: 0,
	fargateGbSeconds: 0,
	fargateSpotVcpuSeconds: 0,
	fargateSpotGbSeconds: 0,
	outputGb: 0,
	transcriptionAudioSeconds: 0,
	llmTokens: {}
};

export interface SeedItem {
	key: string;
	kind: ItemKind;
	status: ItemStatus;
	profile?: string;
	error?: string;
}

export function itemId(key: string, requestId = REQUEST_ID): string {
	return `${requestId}:${key}`;
}

export function itemMessage(key: string, requestId = REQUEST_ID): CallbackMessage {
	return { type: "item", requestId, itemId: itemId(key, requestId), sequence: 1 };
}

export async function seedAccount(destination?: Destination): Promise<void> {
	await accounts().insertOne({
		_id: "account-1",
		slug: "acme",
		name: "Acme",
		sourceBuckets: [],
		...(destination !== undefined && { destination }),
		webhookSecret: SECRET,
		features: { peopleAttributes: false },
		createdAt: new Date()
	});
	await mediaAssets().insertOne(asset);
}

export async function seedRequest(
	requestId: string,
	{
		mode = "encode",
		status = "IN_PROGRESS",
		items = [],
		destination
	}: { mode?: RequestMode; status?: RequestStatus; items?: SeedItem[]; destination?: Destination } = {}
): Promise<void> {
	const now = new Date();
	await requests().insertOne({
		_id: requestId,
		accountId: "account-1",
		assetId: "asset-1",
		clientRequestId: requestId,
		mode,
		analyze: "sync",
		...(mode !== "purge" && { presetSnapshot: genericPreset, postProcess: allPostProcess }),
		assetVersion: 1,
		pendingItems: items.filter((item) => !isTerminal(item.status)).map((item) => itemId(item.key, requestId)),
		status,
		...(destination !== undefined && { destination }),
		...(status !== "ANALYZING" && { enqueuedAt: now }),
		createdAt: now
	});
	if (items.length > 0) {
		await pipelineItems().insertMany(items.map((item) => itemDoc(requestId, item, now)));
	}
}

export async function seedReport(requestId: string, status: RequestStatus): Promise<void> {
	const now = new Date();
	await jobReports().insertOne({
		_id: requestId,
		requestId,
		accountId: "account-1",
		assetId: "asset-1",
		status,
		items: [],
		usage: { byTier: {} },
		resourceUnits: zeroUnits,
		unitsRecordedItems: [],
		completedAt: now,
		createdAt: now
	});
}

function itemDoc(requestId: string, item: SeedItem, now: Date): PipelineItem {
	const terminal = isTerminal(item.status);
	return {
		_id: itemId(item.key, requestId),
		key: item.key,
		requestId,
		assetId: "asset-1",
		accountId: "account-1",
		kind: item.kind,
		...(item.profile !== undefined && { profile: item.profile }),
		queue: "fargate-p1",
		priority: 0,
		status: item.status,
		pendingDeps: [],
		requiredDeps: [],
		dependents: [],
		attempts: 1,
		progress: terminal ? 100 : 0,
		...(item.error !== undefined && { error: item.error }),
		usage: [],
		...(terminal && { completedAt: now }),
		createdAt: now
	};
}
