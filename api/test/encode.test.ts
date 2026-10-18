import request from "supertest";
import { randomUUID } from "node:crypto";
import {
	UnprocessableSourceError,
	ensureIndexes,
	mediaAssets,
	objectStore,
	queueFor,
	requests,
	type AnalyzeMessage
} from "@helios/core";
import { probeSource } from "../../core/src/analyze/probe";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { videoSource } from "../../core/test/helpers/pipelineFixtures";
import { bearer, countAll, seedAccount, seedAsset, seedGenericPreset } from "./helpers/fixtures";
import { mockObjectStore } from "./helpers/apiMocks";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));
jest.mock("../../core/src/analyze/probe", () => ({ probeSource: jest.fn() }));

const app = createApp();
const S3_SOURCE = { source: { bucket: "bucket-a", key: "clips/a.mp4" }, preset: "generic" };

let key: string;
let accountId: string;

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	mockObjectStore();
	({ key, accountId } = await seedAccount());
});

function encode(body: object, query = "") {
	return request(app).post(`/encode${query}`).set("Authorization", bearer(key)).send(body);
}

describe("POST /encode", () => {
	it("accepts an async encode (202) and queues analysis", async () => {
		const res = await encode({ ...S3_SOURCE, analyze: "async" });

		expect(res.status).toBe(202);
		expect(res.body).toMatchObject({ status: "ANALYZING", mode: "encode", items: [] });
		expect(jest.mocked(queueFor<AnalyzeMessage>("analyze").send)).toHaveBeenCalledTimes(1);
	});

	it("returns the existing request with 200 for a repeated requestId", async () => {
		const requestId = randomUUID();
		const first = await encode({ ...S3_SOURCE, requestId });

		const second = await encode({ ...S3_SOURCE, requestId });

		expect(second.status).toBe(200);
		expect(second.body.id).toBe(first.body.id);
		expect((await countAll()).assets).toBe(1);
	});

	it("returns 201 with the analyzed request for a sync encode", async () => {
		jest.mocked(probeSource).mockResolvedValue(videoSource);

		const res = await encode({ ...S3_SOURCE, analyze: "sync" });

		expect(res.status).toBe(201);
		expect(res.body.status).toBe("IN_PROGRESS");
		expect(res.body.items.length).toBeGreaterThan(0);
	});

	it("maps a sync analysis failure to 422 with its error code", async () => {
		jest.mocked(probeSource).mockRejectedValue(new UnprocessableSourceError("Source has no video"));

		const res = await encode({ ...S3_SOURCE, analyze: "sync" });

		expect(res.status).toBe(422);
		expect(res.body.error).toMatchObject({ code: "unprocessable_source", message: "Source has no video" });
		expect(res.body.error.details).toEqual({ requestId: expect.any(String), assetId: expect.any(String) });
	});

	it("rejects sourceMetadata without dryRun with 400", async () => {
		const res = await encode({ ...S3_SOURCE, sourceMetadata: videoSource });

		expect(res.status).toBe(400);
		expect((await countAll()).assets).toBe(0);
	});

	it("returns 422 source_not_found before writing when the source is missing", async () => {
		jest.mocked(objectStore().headObject).mockResolvedValueOnce(false);

		const res = await encode({ ...S3_SOURCE, analyze: "sync" });

		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe("source_not_found");
		expect((await countAll()).assets).toBe(0);
	});

	it("rejects sync analysis of a url source with 400", async () => {
		const res = await encode({ source: { url: "https://example.test/a.mp4" }, preset: "generic", analyze: "sync" });

		expect(res.status).toBe(400);
	});

	it("rejects a bucket that is not in the account allowlist with 403", async () => {
		const res = await encode({ source: { bucket: "other", key: "a.mp4" }, preset: "generic" });

		expect(res.status).toBe(403);
	});

	it("returns 404 for an unknown preset", async () => {
		const res = await encode({ ...S3_SOURCE, preset: "missing-preset" });

		expect(res.status).toBe(404);
	});

	describe("dryRun", () => {
		beforeEach(() => {
			const store = objectStore();
			jest.spyOn(store, "uploadFile").mockResolvedValue(0);
			jest.spyOn(store, "uploadStream").mockResolvedValue(0);
			jest.spyOn(store, "deleteKeys").mockResolvedValue();
		});

		function expectNoS3Writes(): void {
			const store = objectStore();
			expect(store.uploadFile).not.toHaveBeenCalled();
			expect(store.uploadStream).not.toHaveBeenCalled();
			expect(store.deleteKeys).not.toHaveBeenCalled();
			expect(store.createMultipartUpload).not.toHaveBeenCalled();
			expect(store.completeMultipartUpload).not.toHaveBeenCalled();
		}

		it("plans from body sourceMetadata without writing", async () => {
			const res = await encode({ ...S3_SOURCE, sourceMetadata: videoSource }, "?dryRun=true");

			expect(res.status).toBe(200);
			expect(res.body.items.length).toBeGreaterThan(0);
			expect(await countAll()).toMatchObject({ assets: 0, requests: 0 });
			expectNoS3Writes();
		});

		it("probes an s3 source without writing", async () => {
			jest.mocked(probeSource).mockResolvedValue(videoSource);

			const res = await encode(S3_SOURCE, "?dryRun=true");

			expect(res.status).toBe(200);
			expect(probeSource).toHaveBeenCalledWith("https://signed.test/source.mp4");
			expect(await countAll()).toMatchObject({ assets: 0, requests: 0 });
			expectNoS3Writes();
		});

		it("requires sourceMetadata for a url source", async () => {
			const res = await encode({ source: { url: "https://example.test/a.mp4" }, preset: "generic" }, "?dryRun=true");

			expect(res.status).toBe(400);
		});
	});
});

describe("re-encode and post-process", () => {
	it("re-encodes an asset as a new version (202), idempotent on repeat (200)", async () => {
		const asset = await seedAsset(accountId);
		const requestId = randomUUID();

		const first = await request(app)
			.post(`/assets/${asset._id}/re-encode`)
			.set("Authorization", bearer(key))
			.send({ requestId });
		const second = await request(app)
			.post(`/assets/${asset._id}/re-encode`)
			.set("Authorization", bearer(key))
			.send({ requestId });

		expect(first.status).toBe(202);
		expect(first.body).toMatchObject({ mode: "reencode", assetVersion: 2, status: "IN_PROGRESS" });
		expect(second.status).toBe(200);
		expect(second.body.id).toBe(first.body.id);
	});

	it("returns 404 when re-encoding an unknown asset", async () => {
		const res = await request(app).post(`/assets/${randomUUID()}/re-encode`).set("Authorization", bearer(key)).send({});

		expect(res.status).toBe(404);
	});

	it("runs post-processing on an asset (202)", async () => {
		const asset = await seedAsset(accountId);

		const res = await request(app)
			.post(`/assets/${asset._id}/post-process`)
			.set("Authorization", bearer(key))
			.send({ postProcess: { transcribe: true } });

		expect(res.status).toBe(202);
		expect(res.body).toMatchObject({ mode: "postProcess" });
		expect(res.body.postProcess.transcribe).toMatchObject({ translateToEnglish: true });
		expect(await requests().countDocuments({ accountId, mode: "postProcess" })).toBe(1);
		expect(await mediaAssets().countDocuments({ accountId })).toBe(1);
	});
});
