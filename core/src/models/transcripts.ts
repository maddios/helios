import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { TranscriptSchema } from "@helios/contracts";
import { db } from "../db";

export const StoredTranscriptSchema = TranscriptSchema.extend({
	_id: z.string(),
	accountId: z.string(),
	assetId: z.string(),
	createdAt: z.date()
});
export type StoredTranscript = z.infer<typeof StoredTranscriptSchema>;

export const transcripts = () => db().collection<StoredTranscript>("transcripts");

export const transcriptIndexes: IndexDescription[] = [
	{ key: { assetId: 1, language: 1, isTranslation: 1 }, unique: true }
];
