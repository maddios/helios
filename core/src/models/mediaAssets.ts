import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { ActiveStillSchema, MediaAssetOutputSchema, PresetSchema, SourceMetadataSchema } from "@helios/contracts";
import { db } from "../db";

export const MediaAssetSourceSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("s3"), bucket: z.string(), key: z.string() }),
	z.object({ type: z.literal("upload"), key: z.string() }),
	z.object({ type: z.literal("url"), url: z.string(), ingestedKey: z.string().optional() })
]);
export type MediaAssetSource = z.infer<typeof MediaAssetSourceSchema>;

export const MediaAssetSchema = z.object({
	_id: z.string(),
	accountId: z.string(),
	externalId: z.string().optional(),
	source: MediaAssetSourceSchema,
	sourceMetadata: SourceMetadataSchema.optional(),
	presetName: z.string().optional(),
	presetVersion: z.int().optional(),
	presetSnapshot: PresetSchema.optional(),
	version: z.int().min(1),
	outputs: z.record(z.string(), MediaAssetOutputSchema),
	activeStill: ActiveStillSchema.optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
	deletedAt: z.date().optional()
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const mediaAssets = () => db().collection<MediaAsset>("media_assets");

export const mediaAssetIndexes: IndexDescription[] = [
	{ key: { accountId: 1, externalId: 1 } },
	{ key: { accountId: 1, createdAt: -1 } },
	{ key: { "source.key": 1 }, unique: true, partialFilterExpression: { "source.type": "upload" } }
];
