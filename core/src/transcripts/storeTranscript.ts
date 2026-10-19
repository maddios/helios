import { randomUUID } from "node:crypto";
import type { TranscriptFiles, TranscriptSegment } from "@helios/contracts";
import { toSrt, toText, toVtt } from "../captions";
import { transcripts } from "../models";
import { objectStore } from "../storage";
import { transcriptKeys, type TranscriptTrack } from "./keys";

export interface StoreTranscriptInput extends TranscriptTrack {
	slug: string;
	asset: { _id: string; accountId: string };
	segments: TranscriptSegment[];
	durationSec: number;
	model: string;
}

export interface StoreTranscriptResult {
	keys: TranscriptFiles;
	revision: number;
}

export async function storeTranscript(input: StoreTranscriptInput): Promise<StoreTranscriptResult> {
	const { slug, asset, language, isTranslation, segments, durationSec, model } = input;
	const keys = transcriptKeys(slug, asset._id, { language, isTranslation });
	const text = toText(segments);
	await Promise.all([
		objectStore().uploadText(keys.srt, toSrt(segments), "application/x-subrip"),
		objectStore().uploadText(keys.vtt, toVtt(segments), "text/vtt"),
		objectStore().uploadText(keys.txt, text, "text/plain")
	]);
	const doc = await transcripts().findOneAndUpdate(
		{ assetId: asset._id, language, isTranslation },
		{
			$set: { accountId: asset.accountId, segments, text, durationSec, model },
			$inc: { revision: 1 },
			$setOnInsert: { _id: randomUUID(), createdAt: new Date() }
		},
		{ upsert: true, returnDocument: "after" }
	);
	if (doc === null) {
		throw new Error(`Transcript ${language} of asset ${asset._id} was not stored`);
	}
	return { keys, revision: doc.revision };
}
