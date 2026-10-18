import type { SceneAnalysisResult, Transcript } from "@helios/contracts";
import type { SceneAnalysis, StoredTranscript } from "@helios/core";

export function toTranscriptView(transcript: StoredTranscript): Transcript {
	const { language, isTranslation, segments, text, durationSec, model } = transcript;
	return { language, isTranslation, segments, text, durationSec, model };
}

export function toSceneAnalysisView(analysis: SceneAnalysis): SceneAnalysisResult {
	const { promptVersion, model, transcriptLanguage, summary, scenes } = analysis;
	return { promptVersion, model, transcriptLanguage, summary, scenes };
}
