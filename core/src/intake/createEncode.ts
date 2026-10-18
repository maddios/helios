import { ValidationError, type EncodeRequest } from "@helios/contracts";
import { analyzeIfSync } from "./analyzeIfSync";
import { loadAssetRecord, toPreset } from "./loadLiveAsset";
import { createAsset, toAssetSource } from "./sourceAsset";
import { createRequest } from "../pipeline";
import { requests, type Account, type MediaAsset, type PipelineRequest } from "../models";
import { resolvePreset } from "../presetAdmin";
import { assertPublicUrl } from "../ssrf";

export async function createEncode(account: Account, input: EncodeRequest): Promise<PipelineRequest> {
	if (input.analyze === "sync" && "url" in input.source) {
		throw new ValidationError('analyze "sync" cannot be used with a url source');
	}
	if (input.callbackUrl !== undefined) {
		await assertPublicUrl(input.callbackUrl);
	}
	const preset = toPreset(await resolvePreset(account._id, input.preset));
	const asset = await encodeAsset(account, input);
	const { request } = await createRequest({
		requestId: input.requestId,
		asset,
		mode: "encode",
		preset,
		...(input.postProcess !== undefined && { postProcess: input.postProcess }),
		...(input.callbackUrl !== undefined && { callbackUrl: input.callbackUrl }),
		analyze: input.analyze
	});
	return analyzeIfSync(request, input.analyze);
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
