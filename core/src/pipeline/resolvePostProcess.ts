import {
	ValidationError,
	type PostProcessDefaults,
	type PostProcessRequest,
	type ResolvedPostProcess,
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
		return value ? { translateToEnglish: true } : false;
	}
	if (value.language !== undefined && !LANGUAGE_CODES.has(value.language)) {
		throw new ValidationError(`Unsupported transcription language: ${value.language}`, { language: value.language });
	}
	return {
		...(value.language !== undefined && { language: value.language }),
		translateToEnglish: value.translateToEnglish ?? true
	};
}
