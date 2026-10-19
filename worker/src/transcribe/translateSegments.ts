import { CHAT_MODELS, chatJson, type ModelEffort, type UsageMeter } from "@helios/core";
import type { TranscriptSegment } from "@helios/contracts";
import { config } from "../config";
import {
	type TranslationBatch,
	TranslationBatchSchema,
	translationSystemPrompt,
	translationUserContent
} from "./translatePrompt";

export class TranslationMismatchError extends Error {
	constructor(expected: number, received: number) {
		super(`Translation returned ${received} segments for a batch of ${expected}; indices must match the batch`);
		this.name = "TranslationMismatchError";
	}
}

export interface TranslateInput {
	segments: TranscriptSegment[];
	sourceLanguage: string;
	meter: UsageMeter;
	signal: AbortSignal;
}

export interface TranslationResult {
	segments: TranscriptSegment[];
	model: string;
}

export async function translateSegments({
	segments,
	sourceLanguage,
	meter,
	signal
}: TranslateInput): Promise<TranslationResult> {
	const { TRANSLATE_EFFORT, TRANSLATE_BATCH_SEGMENTS } = config();
	const translated: TranscriptSegment[] = [];
	for (const batch of batches(segments, TRANSLATE_BATCH_SEGMENTS)) {
		signal.throwIfAborted();
		translated.push(...(await translateBatch({ batch, sourceLanguage, effort: TRANSLATE_EFFORT, meter, signal })));
	}
	return { segments: translated, model: CHAT_MODELS[TRANSLATE_EFFORT] };
}

interface BatchInput {
	batch: TranscriptSegment[];
	sourceLanguage: string;
	effort: ModelEffort;
	meter: UsageMeter;
	signal: AbortSignal;
}

async function translateBatch({
	batch,
	sourceLanguage,
	effort,
	meter,
	signal
}: BatchInput): Promise<TranscriptSegment[]> {
	const { segments } = await chatJson({
		effort,
		system: translationSystemPrompt(sourceLanguage),
		user: translationUserContent(batch.map((segment, index) => ({ index, text: segment.text }))),
		schema: TranslationBatchSchema,
		schemaName: "translated_segments",
		temperature: 0.2,
		meter,
		signal
	});
	return alignTranslation(batch, segments);
}

function alignTranslation(batch: TranscriptSegment[], translated: TranslationBatch["segments"]): TranscriptSegment[] {
	const ordered = [...translated].sort((a, b) => a.index - b.index);
	const exact = ordered.length === batch.length && ordered.every((item, position) => item.index === position);
	if (!exact) {
		throw new TranslationMismatchError(batch.length, translated.length);
	}
	return batch.map((segment, index) => ({ start: segment.start, end: segment.end, text: ordered[index].text }));
}

function batches<T>(items: T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
		items.slice(index * size, (index + 1) * size)
	);
}
