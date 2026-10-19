import type { AssetPostProcessRequest } from "@helios/contracts";
import { createRequest, type CreateRequestResult } from "../pipeline";
import type { Account, PipelineRequest } from "../models";
import { assertDestination } from "../destinations";
import { loadLiveAsset, snapshotOf } from "./loadLiveAsset";

export async function postProcess(
	account: Account,
	assetId: string,
	input: AssetPostProcessRequest
): Promise<CreateRequestResult> {
	const asset = await loadLiveAsset(account, assetId);
	if (input.destination !== undefined) {
		await assertDestination(input.destination);
	}
	const result = await createRequest({
		requestId: input.requestId,
		asset,
		mode: "postProcess",
		preset: snapshotOf(asset),
		...(input.postProcess !== undefined && { postProcess: input.postProcess }),
		...(input.destination !== undefined && { destination: input.destination }),
		analyze: "async"
	});
	return result;
}
