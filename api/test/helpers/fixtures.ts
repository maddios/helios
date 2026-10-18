import { randomUUID } from "node:crypto";
import {
	accounts,
	createAccount,
	createApiKey,
	genericPreset,
	insertAsset,
	mediaAssets,
	requests,
	seedSystemPreset,
	type MediaAsset,
	type PipelineRequest
} from "@helios/core";
import { videoSource } from "../../../core/test/helpers/pipelineFixtures";

export const BUCKET = "bucket-a";

export interface Seeded {
	accountId: string;
	key: string;
}

export function bearer(key: string): string {
	return `Bearer ${key}`;
}

export async function seedGenericPreset(): Promise<void> {
	await seedSystemPreset(genericPreset);
}

export async function seedAccount(slug = "acme"): Promise<Seeded> {
	const account = await createAccount({
		slug,
		name: `Account ${slug}`,
		sourceBuckets: [BUCKET],
		features: { peopleAttributes: false }
	});
	const { key } = await createApiKey({ scope: "account", accountId: account._id, name: "test" });
	return { accountId: account._id, key };
}

export async function seedAdminKey(): Promise<string> {
	const { key } = await createApiKey({ scope: "admin", name: "test admin" });
	return key;
}

export async function seedAsset(accountId: string, overrides: Partial<MediaAsset> = {}): Promise<MediaAsset> {
	const now = new Date();
	const asset: MediaAsset = {
		_id: randomUUID(),
		accountId,
		source: { type: "s3", bucket: BUCKET, key: "source.mp4" },
		sourceMetadata: videoSource,
		presetName: genericPreset.name,
		presetVersion: genericPreset.version,
		presetSnapshot: genericPreset,
		version: 1,
		outputs: {},
		createdAt: now,
		updatedAt: now,
		...overrides
	};
	await insertAsset(asset);
	return asset;
}

export async function seedRequest(accountId: string, assetId: string, overrides: Partial<PipelineRequest> = {}) {
	const request: PipelineRequest = {
		_id: randomUUID(),
		accountId,
		assetId,
		clientRequestId: randomUUID(),
		mode: "encode",
		analyze: "async",
		presetSnapshot: genericPreset,
		postProcess: { transcribe: false, sceneDetection: false },
		assetVersion: 1,
		pendingItems: [],
		status: "COMPLETE",
		createdAt: new Date(),
		...overrides
	};
	await requests().insertOne(request);
	return request;
}

export async function countAll(): Promise<{ assets: number; requests: number; accounts: number }> {
	return {
		assets: await mediaAssets().countDocuments({}),
		requests: await requests().countDocuments({}),
		accounts: await accounts().countDocuments({})
	};
}
