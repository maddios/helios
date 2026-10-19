import { randomUUID } from "node:crypto";
import type { SceneAnalysisResult } from "@helios/contracts";
import { sceneAnalyses } from "@helios/core";

export interface SceneAnalysisOwner {
	accountId: string;
	assetId: string;
	itemId: string;
	assetVersion: number;
}

export async function storeSceneAnalysis(owner: SceneAnalysisOwner, analysis: SceneAnalysisResult): Promise<void> {
	const { accountId, assetId, itemId, assetVersion } = owner;
	await sceneAnalyses().updateOne(
		{ assetId, itemId },
		{ $set: { ...analysis, accountId, assetVersion, createdAt: new Date() }, $setOnInsert: { _id: randomUUID() } },
		{ upsert: true }
	);
}
