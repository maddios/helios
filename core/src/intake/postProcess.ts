import type { AssetPostProcessRequest } from "@helios/contracts";
import { createRequest } from "../pipeline";
import type { Account, PipelineRequest } from "../models";
import { assertPublicUrl } from "../ssrf";
import { loadLiveAsset, snapshotOf } from "./loadLiveAsset";

export async function postProcess(
	account: Account,
	assetId: string,
	input: AssetPostProcessRequest
): Promise<PipelineRequest> {
	const asset = await loadLiveAsset(account, assetId);
	if (input.callbackUrl !== undefined) {
		await assertPublicUrl(input.callbackUrl);
	}
	const { request } = await createRequest({
		requestId: input.requestId,
		asset,
		mode: "postProcess",
		preset: snapshotOf(asset),
		...(input.postProcess !== undefined && { postProcess: input.postProcess }),
		...(input.callbackUrl !== undefined && { callbackUrl: input.callbackUrl }),
		analyze: "async"
	});
	return request;
}
