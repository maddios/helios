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

export async function findNativeSegments(
	{ accountId, assetId }: TranscriptScope,
	language: string
): Promise<TranscriptSegment[]> {
	const doc = await transcripts().findOne(
		{ accountId, assetId, language, isTranslation: false },
		{ projection: { segments: 1 } }
	);
	if (doc === null) {
		throw new Error(`Native transcript ${language} of asset ${assetId} not found`);
	}
	return doc.segments;
}
