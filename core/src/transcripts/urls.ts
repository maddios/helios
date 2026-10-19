import type { TranscriptFiles } from "@helios/contracts";
import { cdnUrl } from "../cdn";

export function transcriptUrls(keys: TranscriptFiles, revision: number): TranscriptFiles {
	return {
		srt: cdnUrl(keys.srt, revision),
		vtt: cdnUrl(keys.vtt, revision),
		txt: cdnUrl(keys.txt, revision)
	};
}
