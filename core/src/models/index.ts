import type { IndexDescription } from "mongodb";
import { db } from "../db";
import { accountIndexes } from "./accounts";
import { apiKeyIndexes } from "./apiKeys";
import { encodingPresetIndexes } from "./encodingPresets";
import { mediaAssetIndexes } from "./mediaAssets";
import { requestIndexes } from "./requests";
import { pipelineItemIndexes } from "./pipelineItems";
import { jobReportIndexes } from "./jobReports";
import { transcriptIndexes } from "./transcripts";
import { sceneAnalysisIndexes } from "./sceneAnalyses";

export * from "./accounts";
export * from "./apiKeys";
export * from "./encodingPresets";
export * from "./mediaAssets";
export * from "./requests";
export * from "./pipelineItems";
export * from "./jobReports";
export * from "./transcripts";
export * from "./sceneAnalyses";

const indexesByCollection: Record<string, IndexDescription[]> = {
	accounts: accountIndexes,
	api_keys: apiKeyIndexes,
	encoding_presets: encodingPresetIndexes,
	media_assets: mediaAssetIndexes,
	requests: requestIndexes,
	pipeline_items: pipelineItemIndexes,
	job_reports: jobReportIndexes,
	transcripts: transcriptIndexes,
	scene_analyses: sceneAnalysisIndexes
};

export async function ensureIndexes(): Promise<void> {
	for (const [collectionName, indexes] of Object.entries(indexesByCollection)) {
		await db().collection(collectionName).createIndexes(indexes);
	}
}
