import { WebhookEventSchema, WEBHOOK_EVENT_HEADER, WEBHOOK_EVENT_ID_HEADER, WEBHOOK_SIGNATURE_HEADER } from "../src";

const itemEvent = {
	id: "a".repeat(64),
	event: "item.failed",
	createdAt: "2026-10-18T10:00:00.000Z",
	sequence: 1,
	data: {
		requestId: "req-1",
		assetId: "asset-1",
		item: { key: "encode:a", kind: "encode", profile: "mp4_720", status: "ERROR", error: "boom" }
	}
};

describe("WebhookEventSchema", () => {
	it("accepts an item event with optional fields omitted", () => {
		const parsed = WebhookEventSchema.parse({
			...itemEvent,
			data: { ...itemEvent.data, item: { key: "encode:a", kind: "encode", status: "CANCELLED" } }
		});

		expect(parsed.event).toBe("item.failed");
	});

	it("rejects an event name outside the union", () => {
		expect(WebhookEventSchema.safeParse({ ...itemEvent, event: "item.unknown" }).success).toBe(false);
	});

	it("rejects an item event that carries request data instead of an item", () => {
		const { item: _item, ...withoutItem } = itemEvent.data;

		expect(WebhookEventSchema.safeParse({ ...itemEvent, data: withoutItem }).success).toBe(false);
	});

	it("rejects a request event without an asset", () => {
		expect(
			WebhookEventSchema.safeParse({
				id: "a".repeat(64),
				event: "request.completed",
				createdAt: "2026-10-18T10:00:00.000Z",
				sequence: 1,
				data: { request: {} }
			}).success
		).toBe(false);
	});

	it("requires a positive sequence", () => {
		const { sequence: _sequence, ...withoutSequence } = itemEvent;
		expect(WebhookEventSchema.safeParse(withoutSequence).success).toBe(false);
		expect(WebhookEventSchema.safeParse({ ...itemEvent, sequence: 0 }).success).toBe(false);
	});

	it("names the signature and identity headers", () => {
		expect([WEBHOOK_SIGNATURE_HEADER, WEBHOOK_EVENT_ID_HEADER, WEBHOOK_EVENT_HEADER]).toEqual([
			"Helios-Signature",
			"Helios-Event-Id",
			"Helios-Event"
		]);
	});
});
