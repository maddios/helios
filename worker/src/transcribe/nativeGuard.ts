import { findTranscripts, type TranscriptScope } from "@helios/core";

export interface NativeRef {
	language: string;
	revision: number;
}

export class NativeChangedError extends Error {
	constructor(scope: TranscriptScope, language: string) {
		super(`Native transcript ${language} of asset ${scope.assetId} changed during translation`);
		this.name = "NativeChangedError";
	}
}

export async function assertNativeUnchanged(scope: TranscriptScope, native: NativeRef): Promise<void> {
	const current = (await findTranscripts(scope)).find((doc) => !doc.isTranslation && doc.language === native.language);
	if (current?.revision !== native.revision) {
		throw new NativeChangedError(scope, native.language);
	}
}
