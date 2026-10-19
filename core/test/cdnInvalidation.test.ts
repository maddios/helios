import {
	CreateInvalidationCommand,
	ListInvalidationsCommand,
	CloudFrontClient,
	TooManyInvalidationsInProgress
} from "@aws-sdk/client-cloudfront";
import { mockClient } from "aws-sdk-client-mock";
import { resetConfigForTests } from "../src/config";
import { CloudFrontCdn } from "../src/cdn/cloudFrontCdn";
import { RecordingCdn } from "../src/cdn/recordingCdn";
import { cdn, drainCdnInvalidations, enqueueInvalidation, invalidateFileKey, resetCdnForTests } from "../src/cdn";
import { cdnInvalidations, ensureIndexes } from "../src/models";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

const cloudFront = mockClient(CloudFrontClient);
const NOW = new Date("2026-10-19T12:00:00Z");

function useMode(env: Record<string, string>): void {
	process.env = { ...process.env, ...env };
	resetConfigForTests();
	resetCdnForTests();
}

function wildcardPaths(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `/acme/media/a${index}/*`);
}

function listing(statuses: string[]) {
	const Items = statuses.map((Status, index) => ({ Id: `I${index}`, Status, CreateTime: NOW }));
	return { InvalidationList: { Marker: "", MaxItems: 100, IsTruncated: false, Quantity: Items.length, Items } };
}

function createdPaths(): string[][] {
	return cloudFront
		.commandCalls(CreateInvalidationCommand)
		.map((call) => call.args[0].input.InvalidationBatch?.Paths?.Items ?? []);
}

async function statusOf(id: string) {
	return (await cdnInvalidations().findOne({ _id: id }))?.status;
}

describe("cdn invalidation queue", () => {
	const original = process.env;

	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		cloudFront.reset();
		cloudFront.on(CreateInvalidationCommand).resolves({});
		cloudFront.on(ListInvalidationsCommand).resolves(listing([]));
		useMode({ CDN_MODE: "cloudfront", CDN_DISTRIBUTION_ID: "EDIST1" });
	});

	afterEach(() => {
		process.env = original;
		resetConfigForTests();
		resetCdnForTests();
	});

	describe("enqueueInvalidation", () => {
		it("stores one pending document per caller reference", async () => {
			await enqueueInvalidation(["/acme/media/a1/*"], "req-1:purge");
			await enqueueInvalidation(["/acme/media/a1/*"], "req-1:purge");

			expect(await cdnInvalidations().find({}).toArray()).toEqual([
				expect.objectContaining({
					_id: "req-1:purge",
					paths: ["/acme/media/a1/*"],
					status: "PENDING",
					attempts: 0
				})
			]);
		});

		it("queues a raw file key's prefix without calling CloudFront", async () => {
			await invalidateFileKey("acme/files/f1/report.pdf", "file-1:overwrite");

			expect(await cdnInvalidations().findOne({ _id: "file-1:overwrite" })).toEqual(
				expect.objectContaining({ paths: ["/acme/files/f1/*"], status: "PENDING" })
			);
			expect(cloudFront.calls()).toHaveLength(0);
		});
	});

	describe("drainCdnInvalidations", () => {
		it("coalesces pending documents into one invalidation with unique paths", async () => {
			await enqueueInvalidation(["/acme/media/a1/*", "/acme/media/a2/x.jpg"], "req-1:purge");
			await enqueueInvalidation(["/acme/media/a1/*"], "req-2:reencode");

			await drainCdnInvalidations(NOW);

			expect(createdPaths()).toHaveLength(1);
			expect(createdPaths()[0].sort()).toEqual(["/acme/media/a1/*", "/acme/media/a2/x.jpg"]);
			const docs = await cdnInvalidations().find({}).toArray();
			expect(docs.map((doc) => [doc._id, doc.status, doc.sentAt])).toEqual([
				["req-1:purge", "SENT", NOW],
				["req-2:reencode", "SENT", NOW]
			]);
		});

		it("sends nothing while CloudFront has an invalidation in progress", async () => {
			cloudFront.on(ListInvalidationsCommand).resolves(listing(["InProgress"]));
			await enqueueInvalidation(["/acme/media/a1/*"], "req-1:purge");

			await drainCdnInvalidations(NOW);

			expect(cloudFront.commandCalls(CreateInvalidationCommand)).toHaveLength(0);
			expect(await statusOf("req-1:purge")).toBe("PENDING");
		});

		it("sends pending documents once no invalidation is in progress", async () => {
			cloudFront.on(ListInvalidationsCommand).resolves(listing(["Completed"]));
			await enqueueInvalidation(["/acme/media/a1/*"], "req-1:purge");

			await drainCdnInvalidations(NOW);

			expect(createdPaths()).toEqual([["/acme/media/a1/*"]]);
			expect(await statusOf("req-1:purge")).toBe("SENT");
		});

		it("never sends more than 15 wildcard paths in one invalidation", async () => {
			for (const [index, path] of wildcardPaths(20).entries()) {
				await enqueueInvalidation([path], `req-${index}:purge`);
			}

			await drainCdnInvalidations(NOW);

			expect(createdPaths()).toEqual([wildcardPaths(20).slice(0, 15)]);
			expect(await cdnInvalidations().countDocuments({ status: "PENDING" })).toBe(5);

			await drainCdnInvalidations(NOW);

			expect(createdPaths()).toHaveLength(2);
			expect(createdPaths()[1]).toEqual(wildcardPaths(20).slice(15));
			expect(await cdnInvalidations().countDocuments({ status: "PENDING" })).toBe(0);
		});

		it("leaves documents pending when CloudFront throttles the invalidation", async () => {
			cloudFront
				.on(CreateInvalidationCommand)
				.rejects(new TooManyInvalidationsInProgress({ $metadata: {}, message: "too many" }));
			await enqueueInvalidation(["/acme/media/a1/*"], "req-1:purge");

			await expect(drainCdnInvalidations(NOW)).resolves.toBeUndefined();

			expect(await cdnInvalidations().findOne({ _id: "req-1:purge" })).toEqual(
				expect.objectContaining({ status: "PENDING", attempts: 0 })
			);
		});

		it("marks a document failed after repeated errors", async () => {
			cloudFront.on(CreateInvalidationCommand).rejects(new Error("boom"));
			await enqueueInvalidation(["/acme/media/a1/*"], "req-1:purge");

			for (let attempt = 0; attempt < 5; attempt++) {
				await expect(drainCdnInvalidations(NOW)).rejects.toThrow("boom");
			}

			expect(await cdnInvalidations().findOne({ _id: "req-1:purge" })).toEqual(
				expect.objectContaining({ status: "FAILED", attempts: 5 })
			);
		});

		it("marks documents sent without calling CloudFront in recording mode", async () => {
			useMode({ CDN_MODE: "recording" });
			expect(cdn()).toBeInstanceOf(RecordingCdn);
			await enqueueInvalidation(["/acme/media/a1/*"], "req-1:purge");

			await drainCdnInvalidations(NOW);

			expect(await statusOf("req-1:purge")).toBe("SENT");
			expect(cloudFront.calls()).toHaveLength(0);
		});
	});

	describe("adapter selection", () => {
		it("uses CloudFront in cloudfront mode", () => {
			expect(cdn()).toBeInstanceOf(CloudFrontCdn);
		});
	});
});
