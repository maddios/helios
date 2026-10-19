import { ValidationError, type EncodeRequest } from "@helios/contracts";
import { analyzeIfSync } from "./analyzeIfSync";
import { loadAssetRecord, toPreset } from "./loadLiveAsset";
import { createAsset, toAssetSource } from "./sourceAsset";
import { createRequest, type CreateRequestResult } from "../pipeline";
import { requests, type Account, type MediaAsset, type PipelineRequest } from "../models";
import { resolvePreset } from "../presetAdmin";
import { assertDestination } from "../destinations";

export async function createEncode(account: Account, input: EncodeRequest): Promise<CreateRequestResult> {
	if (input.sourceMetadata !== undefined) {
		throw new ValidationError("sourceMetadata is only accepted with dryRun");
	}
	if (input.analyze === "sync" && "url" in input.source) {
		throw new ValidationError('analyze "sync" cannot be used with a url source');
	}
	if (input.destination !== undefined) {
		await assertDestination(input.destination);
	}
	const preset = toPreset(await resolvePreset(account._id, input.preset));
	const asset = await encodeAsset(account, input);
	const result = await createRequest({
		requestId: input.requestId,
		asset,
		mode: "encode",
		preset,
		...(input.postProcess !== undefined && { postProcess: input.postProcess }),
		...(input.destination !== undefined && { destination: input.destination }),
		analyze: input.analyze
	});
	return { ...result, request: await analyzeIfSync(result.request, input.analyze) };
}

async function encodeAsset(account: Account, input: EncodeRequest): Promise<MediaAsset> {
	const repeat =
		input.requestId === undefined
			? null
			: await requests().findOne({ accountId: account._id, clientRequestId: input.requestId });
	if (repeat !== null) {
		return loadAssetRecord(account._id, repeat.assetId);
	}
	return createAsset(account, await toAssetSource(account, input.source), input.externalId);
}
