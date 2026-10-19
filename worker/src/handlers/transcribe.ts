import type { ResolvedTranscribe, TranscriptOutput } from "@helios/contracts";
import {
	findNativeSegments,
	findTranscripts,
	removeStaleTranscripts,
	resolveTargets,
	storeTranscript,
	transcriptKeys,
	TRANSCRIPTION_MODEL,
	type TranscriptScope,
	type TranscriptSummary
} from "@helios/core";
import { config } from "../config";
import { assertNativeUnchanged, type NativeRef } from "../transcribe/nativeGuard";
import { reusableNative } from "../transcribe/nativeReuse";
import { transcribeRunOptions } from "../transcribe/options";
import { transcribeSource, type TranscribedSource } from "../transcribe/transcribeSource";
import { translateTargets, type SpokenTrack, type TrackInput } from "../transcribe/translateTargets";
import { assertCurrent } from "./supersession";
import type { HandlerContext, HandlerResult } from "./types";

export async function transcribeHandler(ctx: HandlerContext): Promise<HandlerResult> {
	const options = transcribeRunOptions(ctx.request);
	const stored = await findTranscripts(scopeOf(ctx));
	const native = reusableNative({
		mode: ctx.request.mode,
		retranscribe: options.retranscribe,
		hint: options.language,
		stored
	});
	if (native === undefined) {
		await transcribeFresh(ctx, options, stored);
	} else {
		await addMissingTranslations(ctx, options, native, stored);
	}
	return { output: { transcripts: await outputsOf(ctx) } };
}

async function transcribeFresh(
	ctx: HandlerContext,
	options: ResolvedTranscribe,
	stored: TranscriptSummary[]
): Promise<void> {
	const source = await transcribeSource(ctx, options.language);
	const regenerated = ctx.request.mode === "encode" ? [] : translationsOf(stored);
	const targets = resolveTargets({
		native: source.language,
		english: options.english,
		translations: [...options.translations, ...regenerated]
	});
	const revision = await storeTrack(ctx, nativeInput(source));
	await translateAndStore(ctx, source, targets, { language: source.language, revision });
	await assertCurrent(ctx);
	await removeStaleTranscripts(ctx.account.slug, ctx.asset._id, [
		{ language: source.language, isTranslation: false },
		...targets.map((language) => ({ language, isTranslation: true }))
	]);
}

async function addMissingTranslations(
	ctx: HandlerContext,
	options: ResolvedTranscribe,
	native: TranscriptSummary,
	stored: TranscriptSummary[]
): Promise<void> {
	const targets = resolveTargets({
		native: native.language,
		english: options.english,
		translations: options.translations
	});
	const missing = targets.filter((language) => !translationsOf(stored).includes(language));
	const track: SpokenTrack = {
		language: native.language,
		durationSec: native.durationSec,
		segments: await findNativeSegments(scopeOf(ctx), native.language)
	};
	await translateAndStore(ctx, track, missing, native);
}

async function translateAndStore(
	ctx: HandlerContext,
	track: SpokenTrack,
	targets: string[],
	native: NativeRef
): Promise<void> {
	await translateTargets({
		track,
		targets,
		meter: ctx.meter,
		signal: ctx.signal,
		concurrency: config().TRANSLATE_TARGET_CONCURRENCY,
		store: async (input) => {
			await assertNativeUnchanged(scopeOf(ctx), native);
			await storeTrack(ctx, input);
		}
	});
}

async function storeTrack(ctx: HandlerContext, input: TrackInput): Promise<number> {
	await assertCurrent(ctx);
	const { revision } = await storeTranscript({ slug: ctx.account.slug, asset: ctx.asset, ...input });
	return revision;
}

async function outputsOf(ctx: HandlerContext): Promise<TranscriptOutput[]> {
	const docs = await findTranscripts(scopeOf(ctx));
	return docs
		.sort((a, b) => Number(a.isTranslation) - Number(b.isTranslation) || a.language.localeCompare(b.language))
		.map((doc) => ({
			language: doc.language,
			isTranslation: doc.isTranslation,
			revision: doc.revision,
			keys: transcriptKeys(ctx.account.slug, ctx.asset._id, doc)
		}));
}

function translationsOf(stored: TranscriptSummary[]): string[] {
	return stored.filter((doc) => doc.isTranslation).map((doc) => doc.language);
}

function scopeOf(ctx: HandlerContext): TranscriptScope {
	return { accountId: ctx.asset.accountId, assetId: ctx.asset._id };
}

function nativeInput(source: TranscribedSource): TrackInput {
	return {
		language: source.language,
		isTranslation: false,
		segments: source.segments,
		durationSec: source.durationSec,
		model: TRANSCRIPTION_MODEL
	};
}
