import { transcripts } from "../models";
import { objectStore } from "../storage";
import { transcriptKeys, type TranscriptTrack } from "./keys";

export async function removeStaleTranscripts(slug: string, assetId: string, kept: TranscriptTrack[]): Promise<void> {
	const docs = await transcripts().find({ assetId }).toArray();
	const stale = docs.filter(
		(doc) =>
			!kept.some(({ language, isTranslation }) => language === doc.language && isTranslation === doc.isTranslation)
	);
	if (stale.length === 0) {
		return;
	}
	await objectStore().deleteKeys(stale.flatMap((doc) => Object.values(transcriptKeys(slug, assetId, doc))));
	await transcripts().deleteMany({ _id: { $in: stale.map((doc) => doc._id) } });
}
