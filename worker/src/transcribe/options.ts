import type { PipelineRequest } from "@helios/core";

export interface TranscribeRunOptions {
	language?: string;
	translateToEnglish: boolean;
}

export function transcribeRunOptions(request: PipelineRequest): TranscribeRunOptions {
	const transcribe = request.postProcess?.transcribe;
	if (transcribe === undefined || transcribe === false) {
		throw new Error(`Request ${request._id} does not request transcription`);
	}
	return {
		...(transcribe.language !== undefined && { language: transcribe.language }),
		translateToEnglish: transcribe.translateToEnglish
	};
}
