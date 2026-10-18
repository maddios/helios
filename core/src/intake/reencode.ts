import type { ReencodeRequest } from "@helios/contracts";
import { createRequest, type CreateRequestResult } from "../pipeline";
import type { Account, PipelineRequest } from "../models";
import { assertPublicUrl } from "../ssrf";
import { currentPresetOf, loadLiveAsset, snapshotOf } from "./loadLiveAsset";

export async function reencode(
	account: Account,
	assetId: string,
	input: ReencodeRequest
): Promise<CreateRequestResult> {
	const asset = await loadLiveAsset(account, assetId);
	if (input.callbackUrl !== undefined) {
		await assertPublicUrl(input.callbackUrl);
	}
	const preset = input.refreshPreset ? await currentPresetOf(account, asset) : snapshotOf(asset);
	const result = await createRequest({
		requestId: input.requestId,
		asset,
		mode: "reencode",
		preset,
		...(input.callbackUrl !== undefined && { callbackUrl: input.callbackUrl }),
		analyze: "async"
	});
	return result;
}
