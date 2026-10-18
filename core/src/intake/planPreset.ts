import { ValidationError, type DryRunRequest, type DryRunResponse, type SourceMetadata } from "@helios/contracts";
import { findLiveAsset } from "../assets";
import { resolvePostProcess } from "../pipeline";
import { dryRunPreset, resolvePreset } from "../presetAdmin";

export async function planPreset(accountId: string, name: string, input: DryRunRequest): Promise<DryRunResponse> {
	const preset = await resolvePreset(accountId, name);
	const items = dryRunPreset({
		preset,
		sourceMetadata: await sourceMetadataOf(accountId, input),
		postProcess: resolvePostProcess(input.postProcess, preset.postProcess),
		mode: input.mode ?? "encode"
	});
	return { items };
}

async function sourceMetadataOf(accountId: string, input: DryRunRequest): Promise<SourceMetadata> {
	if (input.sourceMetadata !== undefined) {
		return input.sourceMetadata;
	}
	if (input.assetId === undefined) {
		throw new ValidationError("Provide exactly one of assetId or sourceMetadata");
	}
	const asset = await findLiveAsset(accountId, input.assetId);
	if (asset.sourceMetadata === undefined) {
		throw new ValidationError("Asset has not been analyzed yet");
	}
	return asset.sourceMetadata;
}
