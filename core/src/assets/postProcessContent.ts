import { NotFoundError } from "@helios/contracts";
import { sceneAnalyses, type SceneAnalysis } from "../models";

export async function latestSceneAnalysis(accountId: string, assetId: string): Promise<SceneAnalysis> {
	const analysis = await sceneAnalyses().findOne({ accountId, assetId }, { sort: { createdAt: -1 } });
	if (analysis === null) {
		throw new NotFoundError(`No scene analysis for asset ${assetId}`);
	}
	return analysis;
}
