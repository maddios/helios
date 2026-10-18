import { z } from "zod";
import { SceneAnalysisResultSchema } from "../scenes";

export const AssetScenesResponseSchema = SceneAnalysisResultSchema.meta({ id: "AssetScenes" });
export type AssetScenesResponse = z.infer<typeof AssetScenesResponseSchema>;
