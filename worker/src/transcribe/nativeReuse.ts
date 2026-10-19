import type { RequestMode } from "@helios/contracts";
import type { TranscriptSummary } from "@helios/core";

export interface NativeReuseInput {
	mode: RequestMode;
	retranscribe: boolean;
	hint: string | undefined;
	stored: TranscriptSummary[];
}

export function reusableNative({ mode, retranscribe, hint, stored }: NativeReuseInput): TranscriptSummary | undefined {
	const natives = stored.filter((doc) => !doc.isTranslation);
	if (natives.length !== 1 || mode !== "postProcess" || retranscribe) {
		return undefined;
	}
	const [native] = natives;
	return hint === undefined || hint === native.language ? native : undefined;
}
