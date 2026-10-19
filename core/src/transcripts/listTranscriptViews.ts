import type { TranscriptView } from "@helios/contracts";
import { findLiveAsset } from "../assets";
import { transcripts } from "../models";
import { transcriptKeys } from "./keys";
import { transcriptUrls } from "./urls";

export interface ListTranscriptsInput {
	slug: string;
	accountId: string;
	assetId: string;
}

export async function listTranscriptViews({
	slug,
	accountId,
	assetId
}: ListTranscriptsInput): Promise<TranscriptView[]> {
	await findLiveAsset(accountId, assetId);
	const docs = await transcripts().find({ accountId, assetId }).sort({ language: 1 }).toArray();
	return docs.map(({ language, isTranslation, revision, segments, text, durationSec, model }) => ({
		language,
		isTranslation,
		segments,
		text,
		durationSec,
		model,
		urls: transcriptUrls(transcriptKeys(slug, assetId, { language, isTranslation }), revision)
	}));
}
