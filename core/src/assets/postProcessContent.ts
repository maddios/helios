import { NotFoundError } from "@helios/contracts";
import { sceneAnalyses, transcripts, type SceneAnalysis, type StoredTranscript } from "../models";

export async function listTranscripts(accountId: string, assetId: string): Promise<StoredTranscript[]> {
	return transcripts().find({ accountId, assetId }).sort({ language: 1 }).toArray();
}

export async function latestSceneAnalysis(accountId: string, assetId: string): Promise<SceneAnalysis> {
	const analysis = await sceneAnalyses().findOne({ accountId, assetId }, { sort: { createdAt: -1 } });
	if (analysis === null) {
		throw new NotFoundError(`No scene analysis for asset ${assetId}`);
	}
	return analysis;
}
