import {
	ValidationError,
	type DryRunResponse,
	type EncodeRequest,
	type EncodeSource,
	type SourceMetadata
} from "@helios/contracts";
import { analyzeConfig, probeSource } from "../analyze";
import { sourceLocation } from "../assets";
import { dryRunPreset, resolvePreset } from "../presetAdmin";
import { resolvePostProcess } from "../pipeline";
import type { Account } from "../models";
import { objectStore } from "../storage";
import { toPreset } from "./loadLiveAsset";
import { toAssetSource } from "./sourceAsset";

export async function dryRunEncode(account: Account, input: EncodeRequest): Promise<DryRunResponse> {
	const preset = toPreset(await resolvePreset(account._id, input.preset));
	const sourceMetadata = input.sourceMetadata ?? (await probeEncodeSource(account, input.source));
	const items = dryRunPreset({
		preset,
		sourceMetadata,
		postProcess: resolvePostProcess(input.postProcess, preset.postProcess),
		mode: "encode"
	});
	return { items };
}

async function probeEncodeSource(account: Account, source: EncodeSource): Promise<SourceMetadata> {
	const stored = await toAssetSource(account, source);
	if (stored.type === "url") {
		throw new ValidationError("A url source needs sourceMetadata for a dry run");
	}
	const { bucket, key } = sourceLocation(stored);
	const url = await objectStore().presignGet(bucket, key, analyzeConfig().SOURCE_URL_TTL_SEC);
	return probeSource(url);
}
