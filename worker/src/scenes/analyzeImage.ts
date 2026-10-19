import type { SceneAnalysisResult } from "@helios/contracts";
import { CHAT_MODELS, chatJson } from "@helios/core";
import { imageSystemPrompt, imageUserContent, SCENES_PROMPT_VERSION } from "../ai/prompts/scenes/v1";
import { sceneSchemas, type SummaryOutput } from "./schemas";
import type { AnalyzeImageInput } from "./types";

export async function analyzeImage({
	imageUrl,
	effort,
	temperature,
	peopleAttributes,
	signal,
	meter
}: AnalyzeImageInput): Promise<SceneAnalysisResult> {
	const { summary } = await chatJson<SummaryOutput>({
		effort,
		system: imageSystemPrompt(peopleAttributes),
		user: imageUserContent(imageUrl),
		schema: sceneSchemas(peopleAttributes).image,
		schemaName: "scene_summary",
		temperature,
		meter,
		signal
	});
	return {
		promptVersion: SCENES_PROMPT_VERSION,
		model: CHAT_MODELS[effort],
		transcriptLanguage: null,
		summary: { ...summary, people: summary.people ?? [] },
		scenes: []
	};
}
