import { ConflictError, type RepresentativeStill, type SceneAnalysisView } from "@helios/contracts";
import { cdnUrl, type MediaAsset, type SceneAnalysis } from "@helios/core";

export function toSceneAnalysisView(analysis: SceneAnalysis, asset: MediaAsset): SceneAnalysisView {
	if (analysis.assetVersion !== asset.version) {
		throw new ConflictError(
			"Scene analysis is stale: the asset changed after it ran; re-run post-process to refresh the scenes.",
			undefined,
			"scenes_stale"
		);
	}
	const { promptVersion, model, transcriptLanguage, summary, scenes } = analysis;
	return {
		promptVersion,
		model,
		transcriptLanguage,
		summary,
		scenes: scenes.map((scene) => ({
			...scene,
			representativeStill: representativeStillOf(asset, scene.representativeStillIndex)
		}))
	};
}

function representativeStillOf(asset: MediaAsset, index: number): RepresentativeStill {
	const still = asset.outputs.stills?.items?.[index];
	if (still === undefined) {
		throw new Error(`Fresh scene analysis of asset ${asset._id} references missing still ${index}`);
	}
	return { index, timestampSec: still.timestampSec, url: cdnUrl(still.key, asset.version) };
}
