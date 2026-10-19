import { z } from "zod";

export const SKIN_TONES = ["fair", "light", "medium", "tan", "deep", "rich"] as const;
export const SKIN_UNDERTONES = ["cool", "warm", "neutral", "olive"] as const;
export const HAIR_TEXTURES = ["straight", "wavy", "curly", "coily"] as const;
export const CURL_TYPES = ["1A", "1B", "1C", "2A", "2B", "2C", "3A", "3B", "3C", "4A", "4B", "4C"] as const;
export const HAIR_LENGTHS = ["short", "medium", "long", "bald"] as const;
export const MAKEUP_LEVELS = ["none", "natural", "full", "bold"] as const;

export const PersonSchema = z.object({
	species: z.string().nullable().describe('"human", or the animal or character type'),
	genderPresentation: z.string().nullable().describe("Apparent gender presentation"),
	approximateAge: z.string().nullable().describe("Approximate age range, e.g. 25-34"),
	skinTone: z.enum(SKIN_TONES).nullable().describe("Visible skin tone on a foundation shade scale"),
	skinUndertone: z.enum(SKIN_UNDERTONES).nullable().describe("Visible skin undertone"),
	hairTexture: z.enum(HAIR_TEXTURES).nullable().describe("Visible hair texture"),
	curlType: z.enum(CURL_TYPES).nullable().describe("Visible curl type, only when clearly visible"),
	hairColor: z.string().nullable().describe("Visible hair color"),
	hairLength: z.enum(HAIR_LENGTHS).nullable().describe("Visible hair length"),
	facialHair: z.string().nullable().describe("Visible facial hair"),
	visibleMakeup: z.enum(MAKEUP_LEVELS).nullable().describe("Visible makeup level"),
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
	products: z.array(ProductSchema).describe("A product that is a focus of the scene"),
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

export const SceneItemOutputSchema = z
	.object({
		sceneCount: z.int().nonnegative().describe("Number of scenes detected"),
		title: z.string().describe("Title of the asset")
	})
	.meta({ id: "SceneItemOutput" });
export type SceneItemOutput = z.infer<typeof SceneItemOutputSchema>;

export const RepresentativeStillSchema = z.object({
	index: z.int().describe("Index of the still within the asset's stills"),
	timestampSec: z.number().describe("Timestamp of the still in seconds"),
	url: z.string().describe("CDN url of the still image")
});
export type RepresentativeStill = z.infer<typeof RepresentativeStillSchema>;

export const SceneViewSchema = SceneSchema.extend({
	representativeStill: RepresentativeStillSchema.describe("Still that best represents the scene")
});
export type SceneView = z.infer<typeof SceneViewSchema>;

export const SceneAnalysisViewSchema = SceneAnalysisResultSchema.extend({
	scenes: z.array(SceneViewSchema).describe("Detected scenes with resolved representative stills")
});
export type SceneAnalysisView = z.infer<typeof SceneAnalysisViewSchema>;

const ModelSceneFields = {
	reasonForTransition: z.string().describe("Why the scene begins at this point"),
	startSec: z.number().describe("Scene start in seconds, chosen from the provided times"),
	transcriptExcerpt: z.string().nullable().describe("Speech of the scene from the transcript, or null"),
	description: z.string().describe("Scene description"),
	setting: z.string().describe("Scene setting"),
	products: z.array(ProductSchema).describe("A product that is a focus of the scene"),
	representativeStillIndex: z.int().describe("Index of the provided still that best represents the scene"),
	continuesPrevious: z
		.boolean()
		.describe("True when this scene is the continuation of the previous window's last scene, otherwise false")
};

export const ModelSceneSchema = z.object({
	...ModelSceneFields,
	people: z.array(PersonSchema).describe("People visible in the scene, apparent attributes only")
});
export const ModelSceneNoPeopleSchema = z.object(ModelSceneFields);

export const SceneSummaryNoPeopleSchema = SceneSummarySchema.omit({ people: true });

export const SceneWindowResultSchema = z.object({
	summary: SceneSummarySchema,
	scenes: z.array(ModelSceneSchema)
});
export const SceneWindowNoPeopleResultSchema = z.object({
	summary: SceneSummaryNoPeopleSchema,
	scenes: z.array(ModelSceneNoPeopleSchema)
});
export const WindowedResultSchema = z.object({ scenes: z.array(ModelSceneSchema) });
export const WindowedNoPeopleResultSchema = z.object({ scenes: z.array(ModelSceneNoPeopleSchema) });
export const SummaryResultSchema = z.object({ summary: SceneSummarySchema });
export const SummaryNoPeopleResultSchema = z.object({ summary: SceneSummaryNoPeopleSchema });
