import type {
	PostProcessDefaults,
	PostProcessRequest,
	ResolvedPostProcess,
	TranscribeOptions
} from "@helios/contracts";

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
	return {
		...(value.language !== undefined && { language: value.language }),
		translateToEnglish: value.translateToEnglish ?? true
	};
}
