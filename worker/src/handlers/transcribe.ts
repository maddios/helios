import type { TranscriptOutput } from "@helios/contracts";
import { removeStaleTranscripts, storeTranscript, TRANSCRIPTION_MODEL, type StoreTranscriptInput } from "@helios/core";
import { translateSegments } from "../transcribe/translateSegments";
import { transcribeRunOptions } from "../transcribe/options";
import { transcribeSource } from "../transcribe/transcribeSource";
import type { HandlerContext, HandlerResult } from "./types";

const ENGLISH = "en";

type StoreInput = Omit<StoreTranscriptInput, "slug" | "asset">;

export async function transcribeHandler(ctx: HandlerContext): Promise<HandlerResult> {
	const options = transcribeRunOptions(ctx.request);
	const source = await transcribeSource(ctx, options.language);
	const inputs: StoreInput[] = [
		{
			language: source.language,
			isTranslation: false,
			segments: source.segments,
			durationSec: source.durationSec,
			model: TRANSCRIPTION_MODEL
		}
	];
	if (source.language !== ENGLISH && options.translateToEnglish) {
		const translated = await translateSegments({
			segments: source.segments,
			sourceLanguage: source.language,
			meter: ctx.meter,
			signal: ctx.signal
		});
		inputs.push({
			language: ENGLISH,
			isTranslation: true,
			segments: translated.segments,
			durationSec: source.durationSec,
			model: translated.model
		});
	}
	const transcripts: TranscriptOutput[] = [];
	for (const input of inputs) {
		transcripts.push(await storeOne(ctx, input));
	}
	await removeStaleTranscripts(ctx.slug, ctx.asset._id, transcripts);
	return { output: { transcripts } };
}

async function storeOne(ctx: HandlerContext, input: StoreInput): Promise<TranscriptOutput> {
	const { keys, revision } = await storeTranscript({ slug: ctx.slug, asset: ctx.asset, ...input });
	return { language: input.language, isTranslation: input.isTranslation, revision, keys };
}
