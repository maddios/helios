import { openAsBlob } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { TranscriptSegment } from "@helios/contracts";
import { aiConfig } from "./config";
import { languageCode } from "./languages";
import { TRANSCRIPTION_MODEL } from "./models";
import { openaiRequest } from "./openaiRequest";
import type { UsageMeter } from "./usageMeter";

const DurationSchema = z.object({ duration: z.number() });

const VerboseTranscriptionSchema = DurationSchema.extend({
	language: z.string(),
	segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() }))
});

export interface TranscribeAudioInput {
	filePath: string;
	language?: string;
	meter: UsageMeter;
	signal: AbortSignal;
}

export interface TranscribeAudioResult {
	language: string;
	durationSec: number;
	segments: TranscriptSegment[];
}

export async function transcribeAudio({
	filePath,
	language,
	meter,
	signal
}: TranscribeAudioInput): Promise<TranscribeAudioResult> {
	const form = new FormData();
	form.append("model", TRANSCRIPTION_MODEL);
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities[]", "segment");
	if (language !== undefined) {
		form.append("language", language);
	}
	form.append("file", await openAsBlob(filePath), path.basename(filePath));
	const body = await openaiRequest({
		path: "/audio/transcriptions",
		body: form,
		timeoutSec: aiConfig().OPENAI_TRANSCRIBE_TIMEOUT_SEC,
		signal
	});
	meter.recordAudio(DurationSchema.parse(body).duration);
	const transcription = VerboseTranscriptionSchema.parse(body);
	return {
		language: languageCode(transcription.language),
		durationSec: transcription.duration,
		segments: transcription.segments.map(({ start, end, text }) => ({ start, end, text: text.trim() }))
	};
}
