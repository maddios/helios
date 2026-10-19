import { z } from "zod";
import { languageNameOf } from "@helios/core";

export const TranslationBatchSchema = z.object({
	segments: z.array(
		z.object({
			index: z.int().describe("Index of the input segment within this batch"),
			text: z.string().describe("Translation of the segment text")
		})
	)
});

export type TranslationBatch = z.infer<typeof TranslationBatchSchema>;

export function translationSystemPrompt(sourceLanguage: string, targetLanguage: string): string {
	return [
		`You translate timed transcript segments from ${languageNameOf(sourceLanguage)} to ${languageNameOf(targetLanguage)}.`,
		"Translate each segment faithfully. Return exactly one output segment per input segment,",
		"with the same index, in the same order. Do not merge or split segments.",
		"Keep names and brands unchanged. Respond only with the JSON object."
	].join(" ");
}

export function translationUserContent(texts: { index: number; text: string }[]): string {
	return JSON.stringify({ segments: texts });
}
