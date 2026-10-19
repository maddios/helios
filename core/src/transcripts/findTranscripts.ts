import type { TranscriptSegment } from "@helios/contracts";
import { transcripts, type StoredTranscript } from "../models";

export interface TranscriptScope {
	accountId: string;
	assetId: string;
}

export type TranscriptSummary = Omit<StoredTranscript, "segments">;

export function findTranscripts({ accountId, assetId }: TranscriptScope): Promise<TranscriptSummary[]> {
	return transcripts()
		.find({ accountId, assetId }, { projection: { segments: 0 } })
		.toArray();
}

export interface TranscriptTrackRef {
	language: string;
	isTranslation: boolean;
}

export async function findTrackSegments(
	{ accountId, assetId }: TranscriptScope,
	{ language, isTranslation }: TranscriptTrackRef
): Promise<TranscriptSegment[]> {
	const doc = await transcripts().findOne(
		{ accountId, assetId, language, isTranslation },
		{ projection: { segments: 1 } }
	);
	if (doc === null) {
		throw new Error(`Transcript ${language} of asset ${assetId} not found`);
	}
	return doc.segments;
}

export function findNativeSegments(scope: TranscriptScope, language: string): Promise<TranscriptSegment[]> {
	return findTrackSegments(scope, { language, isTranslation: false });
}
