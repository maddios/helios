import { z } from "zod";
import { PostProcessRequestSchema } from "../postProcess";
import { SourceMetadataSchema } from "../sourceMetadata";
import { AnalyzeModeSchema, ItemKindSchema, ItemStatusSchema } from "../statuses";
import { ItemQueueNameSchema } from "../queues";
import { PresetNameSchema } from "../preset";
import { DestinationInputSchema } from "../destinations";

const BucketSourceSchema = z
	.object({
		bucket: z.string().describe("Bucket that holds the source object"),
		key: z.string().describe("Key of the source object")
	})
	.strict();

const FileSourceSchema = z
	.object({
		fileId: z.uuid().describe("Id of a stored file")
	})
	.strict();

const UrlSourceSchema = z
	.object({
		url: z.url().describe("Publicly fetchable URL of the source")
	})
	.strict();

export const EncodeSourceSchema = z.union([BucketSourceSchema, FileSourceSchema, UrlSourceSchema]);
export type EncodeSource = z.infer<typeof EncodeSourceSchema>;

export const PlannedItemSchema = z.object({
	key: z.string().describe("Item key, unique within the request"),
	kind: ItemKindSchema.describe("Pipeline item kind"),
	profile: z.string().optional().describe("Profile the item encodes with"),
	queue: ItemQueueNameSchema.describe("Queue the item is dispatched to"),
	priority: z.int().describe("Dispatch priority; higher runs first"),
	status: ItemStatusSchema.describe("Status the item starts in"),
	dependsOn: z
		.array(
			z.object({
				key: z.string().describe("Key of the item this item depends on"),
				required: z.boolean().describe("Whether the dependency must complete successfully")
			})
		)
		.describe("Items this item depends on")
});
export type PlannedItem = z.infer<typeof PlannedItemSchema>;

export const DryRunResponseSchema = z
	.object({
		items: z.array(PlannedItemSchema).describe("Items the request would create")
	})
	.meta({ id: "DryRunResponse" });
export type DryRunResponse = z.infer<typeof DryRunResponseSchema>;

const EncodeRequestFieldsSchema = z.object({
	source: EncodeSourceSchema.describe("Media to encode"),
	preset: PresetNameSchema.describe("Name of the preset to encode with"),
	postProcess: PostProcessRequestSchema.optional().describe("Post-processing to run on the asset"),
	externalId: z.string().min(1).max(255).optional().describe("Caller-side identifier for the asset"),
	requestId: z.uuid().optional().describe("Client idempotency key, stored as clientRequestId"),
	analyze: AnalyzeModeSchema.default("async").describe("Whether source analysis runs inline or queued"),
	sourceMetadata: SourceMetadataSchema.optional().describe(
		"Dry run only: plan against this metadata instead of probing the source"
	)
});

export const EncodeRequestSchema = EncodeRequestFieldsSchema.and(DestinationInputSchema).meta({ id: "EncodeRequest" });
export type EncodeRequest = z.infer<typeof EncodeRequestSchema>;

export const EncodeOptionsSchema = EncodeRequestFieldsSchema.omit({ source: true }).and(DestinationInputSchema);
export type EncodeOptions = z.infer<typeof EncodeOptionsSchema>;

export const EncodeQuerySchema = z
	.object({
		dryRun: z.stringbool().optional().describe("Plan the request without creating it")
	})
	.meta({ id: "EncodeQuery" });
export type EncodeQuery = z.infer<typeof EncodeQuerySchema>;
