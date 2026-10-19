import type { z } from "zod";
import {
	type Person,
	type SceneSummary,
	SceneWindowNoPeopleResultSchema,
	SceneWindowResultSchema,
	SummaryResultSchema,
	SummaryNoPeopleResultSchema,
	WindowedNoPeopleResultSchema,
	WindowedResultSchema
} from "@helios/contracts";
import type { DraftScene } from "./types";

export type WindowedSummary = Omit<SceneSummary, "people"> & { people?: Person[] };
export type ModelDraft = Omit<DraftScene, "people"> & { people?: Person[] };

export interface WindowOutput {
	summary: WindowedSummary;
	scenes: ModelDraft[];
}

export interface WindowedOutput {
	scenes: ModelDraft[];
}

export interface SummaryOutput {
	summary: WindowedSummary;
}

export interface SceneSchemaSet {
	window: z.ZodType<WindowOutput>;
	windowed: z.ZodType<WindowedOutput>;
	image: z.ZodType<SummaryOutput>;
}

export function sceneSchemas(peopleAttributes: boolean): SceneSchemaSet {
	return peopleAttributes
		? { window: SceneWindowResultSchema, windowed: WindowedResultSchema, image: SummaryResultSchema }
		: {
				window: SceneWindowNoPeopleResultSchema,
				windowed: WindowedNoPeopleResultSchema,
				image: SummaryNoPeopleResultSchema
			};
}
