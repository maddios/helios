import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { accounts, cdnInvalidations, ensureIndexes, pipelineItems } from "../src/models";
import { loadRequest } from "../src/pipeline";
import { finalizeRequest } from "../src/pipeline/finalizeRequest";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";
import { insertStoredRequest } from "./helpers/pipelineFixtures";

jest.mock("../src/queue", () => require("./helpers/queueMock"));

const REQUEST_ID = "req-reencode";
const VARIANT_KEY = "resize_cache/acme/media/asset-1/_img/w_100/file.jpg";
const s3 = mockClient(S3Client);
const cloudFront = mockClient(CloudFrontClient);

async function completeAllItems(requestId: string): Promise<void> {
	await pipelineItems().updateMany({ requestId }, { $set: { status: "COMPLETE" } });
}

describe("finalizeRequest for a re-encode", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		s3.reset();
		cloudFront.reset();
		s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: VARIANT_KEY }] });
		s3.on(DeleteObjectsCommand).resolves({});
		await accounts().insertOne({
			_id: "account-1",
			slug: "acme",
			name: "Acme",
			sourceBuckets: [],
			webhookSecret: "secret",
			features: { peopleAttributes: false },
			createdAt: new Date()
		});
	});

	it("deletes the asset's resize cache and queues one invalidation when it completes", async () => {
		await insertStoredRequest(REQUEST_ID, { mode: "reencode" });
		await completeAllItems(REQUEST_ID);
		const request = await loadRequest(REQUEST_ID);

		await finalizeRequest(request, new Date());

		const deleted = s3.commandCalls(DeleteObjectsCommand).flatMap((call) => call.args[0].input.Delete?.Objects ?? []);
		expect(deleted).toEqual([{ Key: VARIANT_KEY }]);
		expect(s3.commandCalls(ListObjectsV2Command)[0].args[0].input.Prefix).toBe("resize_cache/acme/media/asset-1/");
		expect(await cdnInvalidations().find({}).toArray()).toEqual([
			expect.objectContaining({
				_id: `${REQUEST_ID}:reencode`,
				paths: ["/acme/media/asset-1/*"],
				status: "PENDING"
			})
		]);
		expect(cloudFront.calls()).toHaveLength(0);
	});

	it("records the invalidation once when finalize runs again", async () => {
		await insertStoredRequest(REQUEST_ID, { mode: "reencode" });
		await completeAllItems(REQUEST_ID);
		const request = await loadRequest(REQUEST_ID);

		await finalizeRequest(request, new Date());
		await finalizeRequest(request, new Date());

		expect(await cdnInvalidations().countDocuments({})).toBe(1);
	});

	it("does nothing when the re-encode does not complete", async () => {
		await insertStoredRequest(REQUEST_ID, { mode: "reencode" });
		const request = await loadRequest(REQUEST_ID);

		await finalizeRequest(request, new Date(), { status: "CANCELLED" });

		expect(s3.commandCalls(ListObjectsV2Command)).toHaveLength(0);
		expect(await cdnInvalidations().countDocuments({})).toBe(0);
	});
});
