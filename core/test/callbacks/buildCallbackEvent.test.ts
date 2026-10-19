import { WebhookEventSchema, type RequestMode, type RequestStatus } from "@helios/contracts";
import { ensureIndexes, pipelineItems } from "../../src/models";
import { buildCallbackEvent } from "../../src/callbacks";
import type { CallbackMessage } from "../../src/pipeline";
import { resetDb, startMongo, stopMongo } from "../helpers/mongo";
import { itemMessage, REQUEST_ID, seedAccount, seedReport, seedRequest } from "../helpers/callbackFixtures";

jest.mock("../../src/queue", () => require("../helpers/queueMock"));

const requestMessage: CallbackMessage = { type: "request", requestId: REQUEST_ID, sequence: 1 };

async function eventFor(message: CallbackMessage) {
	const { envelope } = await buildCallbackEvent(message, new Date("2026-10-18T10:00:00Z"));
	expect(WebhookEventSchema.safeParse(envelope).success).toBe(true);
	return envelope.event;
}

describe("buildCallbackEvent", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await seedAccount();
	});

	describe("item events", () => {
		it.each([
			["COMPLETE", "item.completed"],
			["ERROR", "item.failed"],
			["SKIPPED", "item.skipped"],
			["CANCELLED", "item.cancelled"]
		] as const)("maps a %s item to %s", async (status, event) => {
			await seedRequest(REQUEST_ID, { items: [{ key: "encode:a", kind: "encode", status }] });

			expect(await eventFor(itemMessage("encode:a"))).toBe(event);
		});

		it("carries the item outputs with CDN urls when the item completed", async () => {
			await seedRequest(REQUEST_ID, { items: [{ key: "encode:a", kind: "encode", status: "COMPLETE" }] });
			await pipelineItems().updateOne(
				{ _id: `${REQUEST_ID}:encode:a` },
				{
					$set: {
						output: {
							assetOutputs: {
								mp4_720: {
									profileName: "mp4_720",
									profileVersion: 1,
									kind: "video",
									key: "acme/media/asset-1/mp4_720.mp4",
									gated: false
								}
							}
						}
					}
				}
			);

			const { envelope } = await buildCallbackEvent(itemMessage("encode:a"), new Date());

			expect(envelope.data).toMatchObject({
				requestId: REQUEST_ID,
				assetId: "asset-1",
				item: { key: "encode:a", kind: "encode", status: "COMPLETE" },
				outputs: { mp4_720: { url: "https://cdn.test.invalid/helios-test-media/acme/media/asset-1/mp4_720.mp4?v=1" } }
			});
		});
	});

	describe("request events", () => {
		it.each([
			["encode", "COMPLETE", "request.completed"],
			["encode", "ERROR", "request.failed"],
			["encode", "CANCELLED", "request.cancelled"],
			["reencode", "COMPLETE", "request.completed"],
			["postProcess", "ERROR", "request.failed"],
			["purge", "COMPLETE", "asset.deleted"],
			["purge", "CANCELLED", "asset.deleted"]
		] as [RequestMode, RequestStatus, string][])("maps %s request in %s to %s", async (mode, status, event) => {
			await seedRequest(REQUEST_ID, { mode, status: "IN_PROGRESS" });
			await seedReport(REQUEST_ID, status);

			expect(await eventFor(requestMessage)).toBe(event);
		});

		it("reads the final status from the job report, not the request document", async () => {
			await seedRequest(REQUEST_ID, { status: "IN_PROGRESS" });
			await seedReport(REQUEST_ID, "COMPLETE");

			const { envelope } = await buildCallbackEvent(requestMessage, new Date());

			expect(envelope.data).toMatchObject({ request: { status: "COMPLETE" } });
			expect(WebhookEventSchema.safeParse(envelope).success).toBe(true);
		});

		it("refuses a request whose job report is missing", async () => {
			await seedRequest(REQUEST_ID, { status: "COMPLETE" });

			await expect(buildCallbackEvent(requestMessage, new Date())).rejects.toThrow("Job report");
		});
	});

	it("gives every item and the final event their own id", async () => {
		await seedRequest(REQUEST_ID, {
			items: [
				{ key: "encode:a", kind: "encode", status: "COMPLETE" },
				{ key: "encode:b", kind: "encode", status: "COMPLETE" }
			]
		});
		await seedReport(REQUEST_ID, "COMPLETE");

		const ids = await Promise.all(
			[itemMessage("encode:a"), itemMessage("encode:b"), requestMessage].map(async (message) => {
				const { envelope } = await buildCallbackEvent(message, new Date());
				return envelope.id;
			})
		);

		expect(new Set(ids).size).toBe(3);
	});
});
