import { pickActiveStill } from "@helios/core";
import { encodeImage } from "./image/encodeImage";
import { encodeVideo } from "./video/encodeVideo";
import { resolveProfiles } from "./profiles";
import type { HandlerContext, HandlerResult } from "./types";

export async function encodeHandler(ctx: HandlerContext): Promise<HandlerResult> {
	const { profile, children } = resolveProfiles(ctx.request, ctx.item);
	const { sourceMetadata } = ctx.asset;
	if (sourceMetadata === undefined) {
		throw new Error(`Asset ${ctx.asset._id} has no source metadata; its items cannot run before analysis`);
	}
	const stored =
		sourceMetadata.type === "image"
			? await encodeImage(ctx, profile, children)
			: await encodeVideo(ctx, sourceMetadata, profile, children);
	const activeStill =
		stored.stillItems === undefined ? undefined : pickActiveStill(ctx.asset.activeStill, stored.stillItems);
	return {
		output: { assetOutputs: stored.assetOutputs, ...(activeStill !== undefined && { activeStill }) },
		outputBytes: stored.outputBytes
	};
}
