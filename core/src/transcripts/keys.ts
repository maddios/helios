import type { TranscriptFiles } from "@helios/contracts";
import { assetPrefix } from "../assets";

export interface TranscriptTrack {
	language: string;
	isTranslation: boolean;
}

export function transcriptKeys(
	slug: string,
	assetId: string,
	{ language, isTranslation }: TranscriptTrack
): TranscriptFiles {
	const name = isTranslation ? `${language}.translated` : language;
	const base = `${assetPrefix(slug, assetId)}transcript/${name}`;
	return { srt: `${base}.srt`, vtt: `${base}.vtt`, txt: `${base}.txt` };
}
