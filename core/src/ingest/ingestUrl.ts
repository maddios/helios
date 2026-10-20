import { ingestKey } from "../assets";
import { mediaAssets, type MediaAsset } from "../models";
import { safeFetch } from "../ssrf";
import { objectStore } from "../storage";

export async function ingestUrl(asset: MediaAsset, slug: string, options: { maxBytes: number }): Promise<string> {
	if (asset.source.type !== "url") {
		throw new Error(`Asset ${asset._id} source is not a URL`);
	}
	if (asset.source.ingestedKey !== undefined) {
		return asset.source.ingestedKey;
	}
	const key = ingestKey(slug, asset._id);
	const response = await safeFetch(asset.source.url, { maxBytes: options.maxBytes, maxRedirects: 5 });
	await objectStore().uploadStream(key, response.body, {
		contentType: "application/octet-stream",
		contentDisposition: "attachment"
	});
	await mediaAssets().updateOne(
		{ _id: asset._id, accountId: asset.accountId },
		{ $set: { "source.ingestedKey": key } }
	);
	return key;
}
