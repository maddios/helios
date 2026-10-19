import { z } from "zod";
import { SceneAnalysisViewSchema } from "../scenes";

export const AssetScenesResponseSchema = SceneAnalysisViewSchema.meta({ id: "AssetScenes" });
export type AssetScenesResponse = z.infer<typeof AssetScenesResponseSchema>;
