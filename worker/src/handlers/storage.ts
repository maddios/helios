import { readdir } from "node:fs/promises";
import path from "node:path";
import type { EncodingProfile, MediaAssetOutput, StillItem, StillsProfile } from "@helios/contracts";
import { objectStore, outputKey, stillKey, stillsPrefix } from "@helios/core";
import { probeOutput } from "../ffmpeg/probe";
import { stillTimestamps } from "../ffmpeg/args";
import { assertCurrent } from "./supersession";
import type { HandlerContext } from "./types";

export interface ProducedOutput {
	profile: EncodingProfile;
	localPath: string;
}

export interface StoredOutputs {
	assetOutputs: Record<string, MediaAssetOutput>;
	outputBytes: number;
	stillItems?: StillItem[];
}

const CONTENT_TYPES: Record<string, string> = {
	".mp4": "video/mp4",
	".mp3": "audio/mpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp"
};

const compareNames = new Intl.Collator("en", { numeric: true }).compare;

function contentTypeOf(localPath: string): string {
	const contentType = CONTENT_TYPES[path.extname(localPath)];
	if (contentType === undefined) {
		throw new Error(`No content type for ${localPath}`);
	}
	return contentType;
}

function compact<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

export async function storeOutputs(ctx: HandlerContext, produced: ProducedOutput[]): Promise<StoredOutputs> {
	await assertCurrent(ctx);
	const assetOutputs: Record<string, MediaAssetOutput> = {};
	let outputBytes = 0;
	let stillItems: StillItem[] | undefined;
	for (const { profile, localPath } of produced) {
		if (profile.type === "stills") {
			const stills = await storeStills(ctx, profile, path.dirname(localPath));
			assetOutputs[profile.name] = stills.output;
			stillItems = stills.items;
			outputBytes += stills.bytes;
		} else {
			const file = await storeFile(ctx, profile, localPath);
			assetOutputs[profile.name] = file.output;
			outputBytes += file.bytes;
		}
	}
	return { assetOutputs, outputBytes, ...(stillItems !== undefined && { stillItems }) };
}

async function storeFile(
	ctx: HandlerContext,
	profile: Exclude<EncodingProfile, StillsProfile>,
	localPath: string
): Promise<{ output: MediaAssetOutput; bytes: number }> {
	const key = outputKey(ctx.account.slug, ctx.asset._id, profile.output);
	const bytes = await objectStore().uploadFile(key, localPath, contentTypeOf(localPath));
	const probe = await probeOutput(localPath);
	const output = compact<MediaAssetOutput>({
		profileName: profile.name,
		profileVersion: profile.version,
		kind: profile.type,
		key,
		codec: probe.codec,
		width: probe.width,
		height: probe.height,
		durationSec: probe.durationSec,
		bitrateK: probe.bitrateK,
		fileSize: bytes,
		gated: false
	});
	return { output, bytes };
}

async function storeStills(
	ctx: HandlerContext,
	profile: StillsProfile,
	dir: string
): Promise<{ output: MediaAssetOutput; bytes: number; items: StillItem[] }> {
	const { asset, account } = ctx;
	const names = (await readdir(dir)).sort(compareNames);
	const timestamps = stillTimestamps(profile.params.fps, names.length);
	const items = names.map((name, index) => ({
		key: stillKey(account.slug, asset._id, profile.output, name),
		timestampSec: timestamps[index]
	}));
	let bytes = 0;
	for (const [index, name] of names.entries()) {
		bytes += await objectStore().uploadFile(items[index].key, path.join(dir, name), "image/jpeg");
	}
	await assertCurrent(ctx);
	await removeStaleStills(
		account.slug,
		asset._id,
		profile.output,
		items.map((item) => item.key)
	);
	return {
		output: { profileName: profile.name, profileVersion: profile.version, kind: "stills", gated: false, items },
		bytes,
		items
	};
}

async function removeStaleStills(slug: string, assetId: string, template: string, keep: string[]): Promise<void> {
	const kept = new Set(keep);
	const existing = await objectStore().listKeys(stillsPrefix(slug, assetId, template));
	const stale = existing.filter((key) => !kept.has(key));
	if (stale.length > 0) {
		await objectStore().deleteKeys(stale);
	}
}
