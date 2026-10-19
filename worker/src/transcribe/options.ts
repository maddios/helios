import type { ResolvedTranscribe } from "@helios/contracts";
import type { PipelineRequest } from "@helios/core";

export function transcribeRunOptions(request: PipelineRequest): ResolvedTranscribe {
	const transcribe = request.postProcess?.transcribe;
	if (transcribe === undefined || transcribe === false) {
		throw new Error(`Request ${request._id} does not request transcription`);
	}
	return transcribe;
}
