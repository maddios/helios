import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { EncodingProfile, StillsProfile } from "@helios/contracts";
import { objectStore, sourceObjectLocation } from "@helios/core";
import { config } from "../../config";
import { convertImage } from "../../image/convert";
import { localOutputPath } from "../outputPath";
import { storeOutputs, type ProducedOutput, type StoredOutputs } from "../storage";

import type { HandlerContext } from "../types";

async function download(url: string, destination: string, signal: AbortSignal): Promise<void> {
	const response = await fetch(url, { signal });
	if (!response.ok || response.body === null) {
		throw new Error(`Source download failed with HTTP ${response.status}`);
	}
	await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

export async function encodeImage(
	ctx: HandlerContext,
	profile: EncodingProfile,
	children: StillsProfile[]
): Promise<StoredOutputs> {
	if (profile.type !== "image") {
		throw new Error(`Profile ${profile.name} of type ${profile.type} cannot encode an image source`);
	}
	const { bucket, key } = sourceObjectLocation(ctx.asset);
	const sourcePath = path.join(ctx.workDir, "source");
	await download(await objectStore().presignGet(bucket, key, config().SOURCE_URL_TTL_SEC), sourcePath, ctx.signal);

	const imagePath = localOutputPath(ctx.workDir, profile.output, ctx.asset._id);
	await convertImage(sourcePath, imagePath, profile.params);
	const produced: ProducedOutput[] = [{ profile, localPath: imagePath }];
	for (const child of children) {
		const localPath = localOutputPath(ctx.workDir, child.output.replace("%04d", "0001"), ctx.asset._id);
		await mkdir(path.dirname(localPath), { recursive: true });
		await convertImage(sourcePath, localPath, { format: "jpg", quality: profile.params.quality });
		produced.push({ profile: child, localPath });
	}
	return storeOutputs(ctx, produced);
}
