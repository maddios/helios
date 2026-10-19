import type { SceneAnalysisResult } from "@helios/contracts";
import type { SceneAnalysis } from "@helios/core";

export function toSceneAnalysisView(analysis: SceneAnalysis): SceneAnalysisResult {
	const { promptVersion, model, transcriptLanguage, summary, scenes } = analysis;
	return { promptVersion, model, transcriptLanguage, summary, scenes };
}
