import { z } from "zod";
import { SourceMetadataSchema } from "../sourceMetadata";
import { ActiveStillSchema, MediaAssetOutputSchema, StillItemSchema } from "../outputs";
import { ItemStatusSchema } from "../statuses";
import { PaginationQuerySchema } from "./common";

export const AssetOutputViewSchema = MediaAssetOutputSchema.extend({
	url: z.string().optional().describe("CDN URL of the output key"),
	items: z
		.array(StillItemSchema.extend({ url: z.string().describe("CDN URL of the still image") }))
		.optional()
		.describe("Individual stills with CDN URLs")
});
export type AssetOutputView = z.infer<typeof AssetOutputViewSchema>;

export const PostProcessStatusSchema = z
	.object({
		transcribe: ItemStatusSchema.optional().describe("Latest status of the transcribe item"),
		scenes: ItemStatusSchema.optional().describe("Latest status of the scenes item")
	})
	.meta({ id: "PostProcessStatus" });
export type PostProcessStatus = z.infer<typeof PostProcessStatusSchema>;

export const AssetViewSchema = z
	.object({
		id: z.string().describe("Asset id"),
		externalId: z.string().optional().describe("Caller-side identifier for the asset"),
		source: z
			.discriminatedUnion("type", [
				z.object({
					type: z.literal("s3"),
					bucket: z.string().describe("Bucket that holds the source object"),
					key: z.string().describe("Key of the source object")
				}),
				z.object({
					type: z.literal("upload"),
					key: z.string().describe("Key of the uploaded source object")
				}),
				z.object({
					type: z.literal("url"),
					url: z.string().describe("URL the source was fetched from")
				})
			])
			.describe("Source location"),
		sourceMetadata: SourceMetadataSchema.optional().describe("Source metadata, absent until analyzed"),
		presetName: z.string().optional().describe("Name of the preset applied to the asset"),
		presetVersion: z.int().optional().describe("Version of the preset applied to the asset"),
		version: z.int().describe("Asset version, incremented on each re-encode"),
		outputs: z.record(z.string(), AssetOutputViewSchema).describe("Outputs keyed by profile name"),
		activeStill: ActiveStillSchema.optional().describe("Selected still image"),
		postProcess: PostProcessStatusSchema.describe("Latest post-processing item statuses"),
		createdAt: z.iso.datetime().describe("When the asset was created"),
		updatedAt: z.iso.datetime().describe("When the asset was last updated")
	})
	.meta({ id: "Asset" });
export type AssetView = z.infer<typeof AssetViewSchema>;

export const AssetListQuerySchema = PaginationQuerySchema.extend({
	externalId: z.string().optional().describe("Only return assets with this external id")
}).meta({ id: "AssetListQuery" });
export type AssetListQuery = z.infer<typeof AssetListQuerySchema>;

export const AssetListResponseSchema = z
	.object({
		assets: z.array(AssetViewSchema).describe("Assets on this page"),
		nextCursor: z.string().optional().describe("Cursor for the next page, absent on the last page")
	})
	.meta({ id: "AssetListResponse" });
export type AssetListResponse = z.infer<typeof AssetListResponseSchema>;

export const AssetDeletedResponseSchema = z
	.object({
		assetId: z.string().describe("Id of the deleted asset")
	})
	.meta({ id: "AssetDeletedResponse" });
export type AssetDeletedResponse = z.infer<typeof AssetDeletedResponseSchema>;
