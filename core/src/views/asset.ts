import type {
	AssetOutputView,
	AssetView,
	MediaAssetOutput,
	PostProcessStatus,
	SourceMetadata
} from "@helios/contracts";
import { cdnUrl } from "../cdn";
import { postProcessStatusOf } from "../assets";
import type { MediaAsset, MediaAssetSource } from "../models";

export async function toAssetViews(accountId: string, assets: MediaAsset[]): Promise<AssetView[]> {
	const statuses = await postProcessStatusOf(
		accountId,
		assets.map((asset) => asset._id)
	);
	return assets.map((asset) => toAssetView(asset, statuses.get(asset._id) ?? {}));
}

export function toOutputViews(
	outputs: Record<string, MediaAssetOutput>,
	version: number
): Record<string, AssetOutputView> {
	return Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, toOutputView(output, version)]));
}

function toAssetView(asset: MediaAsset, postProcess: PostProcessStatus): AssetView {
	return {
		id: asset._id,
		...(asset.externalId !== undefined && { externalId: asset.externalId }),
		source: toSourceView(asset.source),
		...(asset.sourceMetadata !== undefined && { sourceMetadata: withoutProbe(asset.sourceMetadata) }),
		...(asset.presetName !== undefined && { presetName: asset.presetName }),
		...(asset.presetVersion !== undefined && { presetVersion: asset.presetVersion }),
		version: asset.version,
		outputs: toOutputViews(asset.outputs, asset.version),
		...(asset.activeStill !== undefined && { activeStill: asset.activeStill }),
		postProcess,
		createdAt: asset.createdAt.toISOString(),
		updatedAt: asset.updatedAt.toISOString()
	};
}

function toSourceView(source: MediaAssetSource): AssetView["source"] {
	if (source.type === "s3") {
		return { type: "s3", bucket: source.bucket, key: source.key };
	}
	if (source.type === "file") {
		return { type: "file", fileId: source.fileId, key: source.key };
	}
	return { type: "url", url: source.url };
}

function withoutProbe(metadata: SourceMetadata): SourceMetadata {
	const { probe: _probe, ...rest } = metadata;
	return rest;
}

function toOutputView(output: MediaAssetOutput, version: number): AssetOutputView {
	const { items, ...rest } = output;
	return {
		...rest,
		...(output.key !== undefined && { url: cdnUrl(output.key, version) }),
		...(items !== undefined && { items: items.map((item) => ({ ...item, url: cdnUrl(item.key, version) })) })
	};
}
