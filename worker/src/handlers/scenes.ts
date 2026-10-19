import { analyzeImage } from "../scenes/analyzeImage";
import { analyzeScenes } from "../scenes/analyzeScenes";
import type { SceneOptions } from "../scenes/types";
import { config } from "../config";
import { assertCurrent } from "./supersession";
import { imageKeyOf, imageUrl, loadTranscript, stillsOf } from "./scenesInputs";
import { storeSceneAnalysis } from "./scenesStore";
import type { HandlerContext, HandlerResult } from "./types";

export async function scenesHandler(ctx: HandlerContext): Promise<HandlerResult> {
	const cfg = config();
	const { asset, account, signal } = ctx;
	const metadata = asset.sourceMetadata;
	if (metadata === undefined) {
		throw new Error(`Asset ${asset._id} has no source metadata; scenes cannot run before analysis`);
	}
	const options: SceneOptions = {
		effort: cfg.SCENES_EFFORT,
		temperature: cfg.SCENES_TEMPERATURE,
		peopleAttributes: account.features.peopleAttributes,
		signal,
		meter: ctx.meter
	};
	const resolveImage = (key: string) => imageUrl(key, asset.version, cfg.SCENES_IMAGE_TRANSPORT, signal);
	const analysis =
		metadata.type === "image"
			? await analyzeImage({ ...options, imageUrl: await resolveImage(imageKeyOf(asset)) })
			: await analyzeScenes({
					...options,
					durationSec: metadata.durationSec,
					stills: stillsOf(asset),
					resolveImage,
					imageConcurrency: cfg.SCENES_IMAGE_CONCURRENCY,
					transcript: await loadTranscript({ accountId: asset.accountId, assetId: asset._id }),
					maxStills: cfg.SCENES_MAX_STILLS,
					windowSec: cfg.SCENES_WINDOW_SEC,
					snapToleranceSec: cfg.SCENES_SNAP_TOLERANCE_SEC
				});
	await assertCurrent(ctx);
	await storeSceneAnalysis(
		{ accountId: asset.accountId, assetId: asset._id, itemId: ctx.item._id, assetVersion: asset.version },
		analysis
	);
	return { output: { scenes: { sceneCount: analysis.scenes.length, title: analysis.summary.title } } };
}
