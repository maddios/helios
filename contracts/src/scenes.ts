import { z } from "zod";

export const PersonSchema = z.object({
	species: z.string().nullable().describe("Species of the person or character"),
	gender: z.string().nullable().describe("Apparent gender"),
	approximateAge: z.string().nullable().describe("Approximate age"),
	ethnicity: z.string().nullable().describe("Apparent ethnicity"),
	skinColor: z.string().nullable().describe("Skin color"),
	hairColor: z.string().nullable().describe("Hair color"),
	hairType: z.string().nullable().describe("Hair type"),
	hairLength: z.string().nullable().describe("Hair length"),
	facialHair: z.string().nullable().describe("Facial hair"),
	mood: z.string().nullable().describe("Apparent mood")
});
export type Person = z.infer<typeof PersonSchema>;

export const ProductSchema = z.object({
	type: z.string().describe("Product category"),
	name: z.string().describe("Product name")
});
export type Product = z.infer<typeof ProductSchema>;

export const SceneSchema = z.object({
	sceneNumber: z.int().describe("One-based scene number"),
	startSec: z.number().describe("Scene start in seconds"),
	endSec: z.number().describe("Scene end in seconds"),
	reasonForTransition: z.string().describe("Why the scene begins at this point"),
	transcriptExcerpt: z.string().nullable().describe("Transcript excerpt spoken in the scene"),
	description: z.string().describe("Scene description"),
	setting: z.string().describe("Scene setting"),
	products: z.array(ProductSchema).describe("Products visible in the scene"),
	people: z.array(PersonSchema).describe("People visible in the scene"),
	representativeStillIndex: z.int().describe("Index of the representative still for the scene")
});
export type Scene = z.infer<typeof SceneSchema>;

export const SceneSummarySchema = z.object({
	title: z.string().describe("Video title"),
	description: z.string().describe("Video description"),
	setting: z.string().describe("Overall setting"),
	products: z.array(ProductSchema).describe("Products featured across the video"),
	people: z.array(PersonSchema).describe("People featured across the video"),
	moods: z.array(z.string()).describe("Moods across the video"),
	tags: z.array(z.string()).describe("Descriptive tags")
});
export type SceneSummary = z.infer<typeof SceneSummarySchema>;

export const SceneAnalysisResultSchema = z.object({
	promptVersion: z.string().describe("Version of the analysis prompt"),
	model: z.string().describe("Model identifier used for the analysis"),
	transcriptLanguage: z.string().nullable().describe("Language of the transcript used for analysis"),
	summary: SceneSummarySchema.describe("Overall summary of the asset"),
	scenes: z.array(SceneSchema).describe("Detected scenes")
});
export type SceneAnalysisResult = z.infer<typeof SceneAnalysisResultSchema>;
