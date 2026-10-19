import path from "node:path";
import {
	cdnUrl,
	findTrackSegments,
	findTranscripts,
	objectStore,
	type MediaAsset,
	type TranscriptScope
} from "@helios/core";
import type { StillInput, TranscriptInput } from "../scenes/types";

export type ImageTransport = "url" | "base64";

const MIME_BY_EXTENSION: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp"
};

export async function imageUrl(
	key: string,
	version: number,
	transport: ImageTransport,
	signal: AbortSignal
): Promise<string> {
	if (transport === "url") {
		return cdnUrl(key, version);
	}
	const mime = MIME_BY_EXTENSION[path.extname(key).toLowerCase()];
	if (mime === undefined) {
		throw new Error(`No image mime type for ${key}`);
	}
	return `data:${mime};base64,${(await objectStore().downloadBuffer(key, signal)).toString("base64")}`;
}

export function stillsOf(asset: MediaAsset): StillInput[] {
	const items = asset.outputs.stills?.items;
	if (items === undefined) {
		throw new Error(`Asset ${asset._id} has no stills output`);
	}
	return items.map((item, index) => ({ index, timestampSec: item.timestampSec, key: item.key }));
}

export function imageKeyOf(asset: MediaAsset): string {
	const key = Object.values(asset.outputs).find((output) => output.kind === "image")?.key;
	if (key === undefined) {
		throw new Error(`Image asset ${asset._id} has no image output`);
	}
	return key;
}

export async function loadTranscript(scope: TranscriptScope): Promise<TranscriptInput | null> {
	const docs = await findTranscripts(scope);
	const doc =
		docs.find((candidate) => candidate.isTranslation && candidate.language === "en") ??
		docs.find((candidate) => !candidate.isTranslation);
	if (doc === undefined) {
		return null;
	}
	const { language, isTranslation } = doc;
	return { language, segments: await findTrackSegments(scope, { language, isTranslation }) };
}
