import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { SceneAnalysisResultSchema } from "@helios/contracts";
import { db } from "../db";

export const SceneAnalysisSchema = SceneAnalysisResultSchema.extend({
	_id: z.string(),
	accountId: z.string(),
	assetId: z.string(),
	createdAt: z.date()
});
export type SceneAnalysis = z.infer<typeof SceneAnalysisSchema>;

export const sceneAnalyses = () => db().collection<SceneAnalysis>("scene_analyses");

export const sceneAnalysisIndexes: IndexDescription[] = [{ key: { assetId: 1, createdAt: -1 } }];
