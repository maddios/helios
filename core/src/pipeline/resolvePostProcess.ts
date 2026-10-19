import {
	ValidationError,
	type PostProcessDefaults,
	type PostProcessRequest,
	type ResolvedPostProcess,
	type ResolvedTranscribe,
	type TranscribeOptions
} from "@helios/contracts";
import { LANGUAGE_CODES } from "../ai";

export function resolvePostProcess(
	request: PostProcessRequest | undefined,
	defaults: PostProcessDefaults
): ResolvedPostProcess {
	return {
		transcribe: resolveTranscribe(request?.transcribe ?? defaults.transcribe),
		sceneDetection: request?.sceneDetection ?? defaults.sceneDetection
	};
}

function resolveTranscribe(value: boolean | TranscribeOptions): ResolvedPostProcess["transcribe"] {
	if (typeof value === "boolean") {
		return value ? { translations: [], english: true, retranscribe: false } : false;
	}
	const translations = value.translations ?? [];
	assertKnownCodes([value.language, ...translations]);
	return {
		...(value.language !== undefined && { language: value.language }),
		translations: [...new Set(translations)],
		english: value.english ?? true,
		retranscribe: value.retranscribe ?? false
	} satisfies ResolvedTranscribe;
}

function assertKnownCodes(codes: (string | undefined)[]): void {
	const unknown = [...new Set(codes)].filter((code): code is string => code !== undefined && !LANGUAGE_CODES.has(code));
	if (unknown.length > 0) {
		throw new ValidationError(`Unsupported transcription languages: ${unknown.join(", ")}`, { languages: unknown });
	}
}
