import request from "supertest";
import { randomUUID } from "node:crypto";
import {
	ensureIndexes,
	mediaAssets,
	pipelineItems,
	queueFor,
	UnprocessableSourceError,
	type ItemMessage
} from "@helios/core";
import { probeSource } from "../../core/src/analyze/probe";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { videoSource } from "../../core/test/helpers/pipelineFixtures";
import { bearer, seedAccount, seedAsset, seedGenericPreset } from "./helpers/fixtures";
import { mockObjectStore } from "./helpers/apiMocks";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));
jest.mock("../../core/src/analyze/probe", () => ({ probeSource: jest.fn() }));

const app = createApp();
const CDN_BASE = "https://cdn.test.invalid/helios-test-media";
const STILLS = {
	stills: {
		profileName: "stills",
		profileVersion: 1,
		kind: "stills" as const,
		key: "acme/media/x/stills",
		gated: false,
		items: [
			{ key: "acme/media/x/still-0.jpg", timestampSec: 0 },
			{ key: "acme/media/x/still-1.jpg", timestampSec: 5 }
		]
	},
	mp4: { profileName: "mp4", profileVersion: 1, kind: "video" as const, key: "acme/media/x/out.mp4", gated: false }
};

let key: string;
let accountId: string;
let slug: string;

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	mockObjectStore();
	({ key, accountId } = await seedAccount("acme"));
	slug = "acme";
});

describe("assets", () => {
	it("gets an asset with CDN urls for outputs and stills", async () => {
		const asset = await seedAsset(accountId, { version: 3, outputs: STILLS, externalId: "ext-1" });

		const res = await request(app).get(`/assets/${asset._id}`).set("Authorization", bearer(key));

		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ id: asset._id, externalId: "ext-1", version: 3 });
		expect(res.body.outputs.mp4.url).toBe(`${CDN_BASE}/acme/media/x/out.mp4?v=3`);
		expect(res.body.outputs.stills.items[1].url).toBe(`${CDN_BASE}/acme/media/x/still-1.jpg?v=3`);
		expect(res.body.sourceMetadata).not.toHaveProperty("probe");
		expect(res.body.postProcess).toEqual({});
	});

	it("returns 404 for another account's asset", async () => {
		const asset = await seedAsset(randomUUID());

		const res = await request(app).get(`/assets/${asset._id}`).set("Authorization", bearer(key));

		expect(res.status).toBe(404);
	});

	it("lists assets by externalId with cursor pagination", async () => {
		for (const id of ["a", "b", "c"]) {
			await seedAsset(accountId, { externalId: "batch", createdAt: new Date(Date.now() + id.charCodeAt(0)) });
		}
		await seedAsset(accountId, { externalId: "other" });

		const first = await request(app).get("/assets?externalId=batch&limit=2").set("Authorization", bearer(key));
		const second = await request(app)
			.get(`/assets?externalId=batch&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`)
			.set("Authorization", bearer(key));

		expect(first.status).toBe(200);
		expect(first.body.assets).toHaveLength(2);
		expect(first.body.nextCursor).toEqual(expect.any(String));
		expect(second.body.assets).toHaveLength(1);
		expect(second.body.nextCursor).toBeUndefined();
	});

	it("rejects a malformed cursor with 400", async () => {
		const res = await request(app).get("/assets?cursor=!!!").set("Authorization", bearer(key));

		expect(res.status).toBe(400);
	});

	it("selects an active still and rejects an out-of-range index", async () => {
		const asset = await seedAsset(accountId, { outputs: STILLS });

		const ok = await request(app)
			.patch(`/assets/${asset._id}/active-still`)
			.set("Authorization", bearer(key))
			.send({ index: 1 });
		const bad = await request(app)
			.patch(`/assets/${asset._id}/active-still`)
			.set("Authorization", bearer(key))
			.send({ index: 9 });

		expect(ok.status).toBe(200);
		expect(ok.body.activeStill).toMatchObject({ index: 1, timestampSec: 5, selectedByUser: true });
		expect(bad.status).toBe(400);
	});

	it("reports post-process status for each asset of a page from one lookup", async () => {
		const processed = await seedAsset(accountId, { externalId: "pp" });
		const plain = await seedAsset(accountId, { externalId: "pp" });
		await request(app)
			.post(`/assets/${processed._id}/post-process`)
			.set("Authorization", bearer(key))
			.send({ postProcess: { transcribe: true } });

		const res = await request(app).get("/assets?externalId=pp").set("Authorization", bearer(key));

		const byId = new Map<string, { postProcess: object }>(
			res.body.assets.map((item: { id: string }) => [item.id, item])
		);
		expect(res.status).toBe(200);
		expect(byId.get(processed._id)?.postProcess).toMatchObject({ transcribe: expect.any(String) });
		expect(byId.get(plain._id)?.postProcess).toEqual({});
	});

	it("returns empty transcripts and 404 scenes until post-processing produces them", async () => {
		const asset = await seedAsset(accountId);

		const transcripts = await request(app).get(`/assets/${asset._id}/transcripts`).set("Authorization", bearer(key));
		const scenes = await request(app).get(`/assets/${asset._id}/scenes`).set("Authorization", bearer(key));

		expect(transcripts.body).toEqual({ transcripts: [] });
		expect(scenes.status).toBe(404);
	});

	it("deletes an asset with 202, tombstones it and purges its items", async () => {
		const asset = await seedAsset(accountId, { outputs: STILLS });

		const res = await request(app).delete(`/assets/${asset._id}`).set("Authorization", bearer(key));
		const after = await request(app).get(`/assets/${asset._id}`).set("Authorization", bearer(key));

		expect(res.status).toBe(202);
		expect(res.body).toEqual({ assetId: asset._id });
		expect(after.status).toBe(404);
		expect(await mediaAssets().countDocuments({ _id: asset._id, deletedAt: { $exists: true } })).toBe(1);
		const purgeItems = await pipelineItems().find({ assetId: asset._id, kind: "purge" }).toArray();
		expect(purgeItems.map((item) => item.queue)).toEqual(["fargate-p2"]);
		expect(jest.mocked(queueFor<ItemMessage>("fargate-p2").sendBatch)).toHaveBeenCalled();
	});
});

describe("uploads and files", () => {
	it("creates a presigned single upload under the account slug", async () => {
		const res = await request(app)
			.post("/uploads/presigned")
			.set("Authorization", bearer(key))
			.send({ filename: "clip.mp4", sizeBytes: 1024, contentType: "video/mp4" });

		expect(res.status).toBe(201);
		expect(res.body.uploadKey.startsWith(`${slug}/uploads/`)).toBe(true);
		expect(res.body.url).toBe("https://signed.test/put");
	});

	it("rejects an upload above the size limit with 400", async () => {
		const res = await request(app)
			.post("/uploads/presigned")
			.set("Authorization", bearer(key))
			.send({ filename: "huge.mp4", sizeBytes: 10 * 1024 ** 4 });

		expect(res.status).toBe(400);
	});

	it("runs the multipart lifecycle: create, complete with encode, abort", async () => {
		const created = await request(app)
			.post("/uploads/multipart")
			.set("Authorization", bearer(key))
			.send({ filename: "big.mp4", sizeBytes: 12 * 1024 * 1024 });
		const { uploadId, uploadKey, parts } = created.body;

		const completed = await request(app)
			.post(`/uploads/multipart/${uploadId}/complete`)
			.set("Authorization", bearer(key))
			.send({
				uploadKey,
				parts: parts.map((part: { partNumber: number }) => ({ partNumber: part.partNumber, etag: "etag" })),
				encode: { preset: "generic", analyze: "async", postProcess: { transcribe: false, sceneDetection: false } }
			});
		const aborted = await request(app)
			.delete(`/uploads/multipart/${uploadId}?uploadKey=${encodeURIComponent(uploadKey)}`)
			.set("Authorization", bearer(key));

		expect(created.status).toBe(201);
		expect(parts.length).toBeGreaterThan(0);
		expect(completed.status).toBe(202);
		expect(completed.body.request).toMatchObject({ mode: "encode", status: "ANALYZING" });
		expect(aborted.status).toBe(204);
	});

	describe("multipart complete with encode", () => {
		async function completeWithEncode(encode: object) {
			const created = await request(app)
				.post("/uploads/multipart")
				.set("Authorization", bearer(key))
				.send({ filename: "big.mp4", sizeBytes: 12 * 1024 * 1024 });
			const { uploadId, uploadKey, parts } = created.body;
			return request(app)
				.post(`/uploads/multipart/${uploadId}/complete`)
				.set("Authorization", bearer(key))
				.send({
					uploadKey,
					parts: parts.map((part: { partNumber: number }) => ({ partNumber: part.partNumber, etag: "etag" })),
					encode
				});
		}

		it("answers 201 for a sync encode", async () => {
			jest.mocked(probeSource).mockResolvedValue(videoSource);

			const res = await completeWithEncode({ preset: "generic", analyze: "sync" });

			expect(res.status).toBe(201);
			expect(res.body.request).toMatchObject({ status: "IN_PROGRESS" });
			expect(res.body.uploadKey).toMatch(/^acme\/uploads\//);
		});

		it("answers 422 with the request and asset ids when a sync analysis fails", async () => {
			jest.mocked(probeSource).mockRejectedValue(new UnprocessableSourceError("Source has no video"));

			const res = await completeWithEncode({ preset: "generic", analyze: "sync" });

			expect(res.status).toBe(422);
			expect(res.body.error).toMatchObject({ code: "unprocessable_source", message: "Source has no video" });
			expect(res.body.error.details).toEqual({ requestId: expect.any(String), assetId: expect.any(String) });
		});

		it("rejects sourceMetadata in the encode options with 400", async () => {
			const res = await completeWithEncode({ preset: "generic", sourceMetadata: videoSource });

			expect(res.status).toBe(400);
		});
	});

	it("rejects a multipart complete with a foreign upload key with 403", async () => {
		const res = await request(app)
			.post("/uploads/multipart/upload-1/complete")
			.set("Authorization", bearer(key))
			.send({ uploadKey: "other-account/uploads/x.mp4", parts: [{ partNumber: 1, etag: "e" }] });

		expect(res.status).toBe(403);
	});

	it("returns a presigned raw file upload with a CDN url", async () => {
		const res = await request(app)
			.post("/files")
			.set("Authorization", bearer(key))
			.send({ filename: "notes.pdf", contentType: "application/pdf" });

		expect(res.status).toBe(201);
		expect(res.body.fileKey.startsWith(`${slug}/files/`)).toBe(true);
		expect(res.body.url).toBe(`${CDN_BASE}/${res.body.fileKey}`);
	});
});
