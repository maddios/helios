import { config } from "../config";
import type { MediaAsset } from "../models";
import { ingestKey } from "./keys";

export function sourceObjectLocation(asset: MediaAsset): { bucket: string; key: string } {
	const { source } = asset;
	if (source.type === "s3") {
		return { bucket: source.bucket, key: source.key };
	}
	if (source.type === "upload") {
		return { bucket: config().MEDIA_BUCKET, key: source.key };
	}
	if (source.ingestedKey === undefined) {
		throw new Error(`URL source ${source.url} has not been ingested`);
	}
	return { bucket: config().MEDIA_BUCKET, key: source.ingestedKey };
}
