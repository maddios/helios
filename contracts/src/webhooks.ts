import { z } from "zod";
import { AssetOutputViewSchema, AssetViewSchema } from "./api/assets";
import { RequestViewSchema } from "./api/requests";
import { TranscriptFilesSchema } from "./transcript";
import { ItemKindSchema, ItemStatusSchema } from "./statuses";

export const WEBHOOK_SIGNATURE_HEADER = "Helios-Signature";
export const WEBHOOK_EVENT_ID_HEADER = "Helios-Event-Id";
export const WEBHOOK_EVENT_HEADER = "Helios-Event";
export const WEBHOOK_TOLERANCE_SEC = 300;

const ITEM_EVENTS = ["item.completed", "item.failed", "item.skipped", "item.cancelled"] as const;
const REQUEST_EVENTS = ["request.completed", "request.failed", "request.cancelled", "asset.deleted"] as const;
export const TEST_EVENT_NAME = "helios.test";

export type ItemEventName = (typeof ITEM_EVENTS)[number];
export type RequestEventName = (typeof REQUEST_EVENTS)[number];
export type WebhookEventName = ItemEventName | RequestEventName | typeof TEST_EVENT_NAME;

const WebhookItemSchema = z
	.object({
		key: z.string().describe("Item key, unique within the request"),
		kind: ItemKindSchema.describe("Pipeline item kind"),
		profile: z.string().optional().describe("Profile the item encodes with"),
		status: ItemStatusSchema.describe("Terminal status the item settled in"),
		error: z.string().optional().describe("Error message when the item failed")
	})
	.meta({ id: "WebhookItem" });

const WebhookTranscriptSchema = z
	.object({
		language: z.string().describe("Language of the transcript"),
		isTranslation: z.boolean().describe("Whether the transcript is a translation"),
		urls: TranscriptFilesSchema.describe("CDN urls of the transcript files")
	})
	.meta({ id: "WebhookTranscript" });

const ItemEventDataSchema = z
	.object({
		requestId: z.string().describe("Id of the request the item belongs to"),
		assetId: z.string().describe("Id of the asset the item operates on"),
		item: WebhookItemSchema.describe("The item that settled"),
		outputs: z
			.record(z.string(), AssetOutputViewSchema)
			.optional()
			.describe("Outputs the item produced, keyed by profile name, with CDN URLs"),
		transcripts: z.array(WebhookTranscriptSchema).optional().describe("Transcripts the item produced, with CDN urls")
	})
	.meta({ id: "WebhookItemEventData" });

const RequestEventDataSchema = z
	.object({
		request: RequestViewSchema.describe("The request in its final state"),
		asset: AssetViewSchema.describe("The asset in its state after the request")
	})
	.meta({ id: "WebhookRequestEventData" });

const envelope = {
	id: z.string().describe("Event id, stable across redeliveries of the same event"),
	createdAt: z.iso.datetime().describe("When the event was created")
};

const sequence = z
	.int()
	.positive()
	.describe("Per-request event number, starting at 1, increasing in creation order; gaps are possible");

const TestEventDataSchema = z
	.object({ accountId: z.string().describe("Id of the account the test event was sent for") })
	.meta({ id: "WebhookTestEventData" });

function itemEvent<const E extends ItemEventName>(event: E) {
	return z
		.object({
			...envelope,
			sequence,
			event: z.literal(event).describe("Event name"),
			data: ItemEventDataSchema.describe("Item event data")
		})
		.meta({ id: event });
}

function testEvent() {
	return z
		.object({
			...envelope,
			sequence: z.literal(0).describe("Test events always carry sequence 0"),
			event: z.literal(TEST_EVENT_NAME).describe("Event name"),
			data: TestEventDataSchema.describe("Test event data")
		})
		.meta({ id: TEST_EVENT_NAME });
}

function requestEvent<const E extends RequestEventName>(event: E) {
	return z
		.object({
			...envelope,
			sequence,
			event: z.literal(event).describe("Event name"),
			data: RequestEventDataSchema.describe("Request event data")
		})
		.meta({ id: event });
}

export const WebhookEventSchema = z
	.discriminatedUnion("event", [
		itemEvent("item.completed"),
		itemEvent("item.failed"),
		itemEvent("item.skipped"),
		itemEvent("item.cancelled"),
		requestEvent("request.completed"),
		requestEvent("request.failed"),
		requestEvent("request.cancelled"),
		requestEvent("asset.deleted"),
		testEvent()
	])
	.describe("Event posted to the account's callback URL, signed with the webhook secret")
	.meta({ id: "WebhookEvent" });
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
