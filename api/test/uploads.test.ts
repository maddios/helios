import request from "supertest";
import { ensureIndexes, files, objectStore, queueFor, type FileRecord } from "@helios/core";
import { probeSource } from "../../core/src/analyze/probe";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { videoSource } from "../../core/test/helpers/pipelineFixtures";
import { bearer, seedAccount, seedGenericPreset } from "./helpers/fixtures";
import { mockObjectStore } from "./helpers/apiMocks";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));
jest.mock("../../core/src/analyze/probe", () => ({ probeSource: jest.fn() }));

const app = createApp();
const PNG_BYTES = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
	Buffer.from("IHDR"),
	Buffer.from([0, 0, 0x00, 0x20, 0, 0, 0, 0x10, 8, 6, 0, 0, 0])
]);
const MiB = 1024 * 1024;

let key: string;

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	mockObjectStore();
	({ key } = await seedAccount("acme"));
	jest.spyOn(objectStore(), "objectInfo").mockResolvedValue({ size: PNG_BYTES.length, etag: '"e"' });
	jest.spyOn(objectStore(), "readHead").mockResolvedValue(PNG_BYTES);
	jest.spyOn(objectStore(), "listKeys").mockResolvedValue([]);
	jest.spyOn(objectStore(), "deleteKeys").mockResolvedValue();
});

function post(path: string, body: object) {
	return request(app).post(path).set("Authorization", bearer(key)).send(body);
}

function imageBody(extra: object = {}) {
	return { filename: "logo.png", sizeBytes: PNG_BYTES.length, contentType: "image/png", ...extra };
}

async function createFile(extra: object = {}): Promise<string> {
	const res = await post("/uploads", imageBody(extra));
	return res.body.fileId;
}

describe("POST /uploads", () => {
	it("answers 201 with one presigned PUT for a file under the threshold", async () => {
		const res = await post("/uploads", imageBody());

		expect(res.status).toBe(201);
		expect(res.body).toMatchObject({
			mode: "single",
			url: "https://signed.test/put",
			headers: { "Content-Type": "image/png" },
			key: expect.stringMatching(/^acme\/files\//)
		});
	});

	it("answers 201 with multipart part URLs for a file over the threshold", async () => {
		jest.spyOn(objectStore(), "createMultipartUpload").mockResolvedValue("up-1");

		const res = await post(
			"/uploads",
			imageBody({ filename: "clip.mp4", sizeBytes: 12 * MiB, contentType: "video/mp4" })
		);

		expect(res.status).toBe(201);
		expect(res.body).toMatchObject({ mode: "multipart", uploadId: "up-1", partSizeBytes: 5 * MiB });
		expect(res.body.parts).toHaveLength(3);
	});

	it("answers 422 policy_violation for a content type the account policy does not allow", async () => {
		await put("/account/upload-policy", { allowedContentTypes: ["video/*"], maxBytes: 100 * MiB });

		const res = await post("/uploads", imageBody());

		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe("policy_violation");
	});

	it("answers 400 for a file over the upload limit", async () => {
		const res = await post("/uploads", imageBody({ sizeBytes: 10 * 1024 ** 4 }));

		expect(res.status).toBe(400);
	});
});

describe("POST /uploads/:fileId/complete", () => {
	it("answers 200 with the stored file, its CDN url and image dimensions", async () => {
		const fileId = await createFile();

		const res = await post(`/uploads/${fileId}/complete`, { store: true });

		expect(res.status).toBe(200);
		expect(res.body.file).toMatchObject({
			id: fileId,
			status: "STORED",
			contentType: "image/png",
			image: { width: 32, height: 16, format: "png" },
			url: expect.stringMatching(/\/acme\/files\/.+\/logo\.png\?v=\d+$/)
		});
		expect(res.body.request).toBeUndefined();
	});

	it("answers 422 policy_violation when the stored bytes are not the declared image", async () => {
		jest.spyOn(objectStore(), "readHead").mockResolvedValue(Buffer.from("not an image at all"));
		const fileId = await createFile();

		const res = await post(`/uploads/${fileId}/complete`, { store: true });

		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe("policy_violation");
	});

	it("answers 201 for a sync encode of the stored file", async () => {
		jest.mocked(probeSource).mockResolvedValue(videoSource);
		const fileId = await createFile();

		const res = await post(`/uploads/${fileId}/complete`, { encode: { preset: "generic", analyze: "sync" } });

		expect(res.status).toBe(201);
		expect(res.body.request).toMatchObject({ status: "IN_PROGRESS" });
		expect(res.body.file.status).toBe("STORED");
	});

	it("answers 202 for an async encode, and a repeat completion returns the same request", async () => {
		const fileId = await createFile();
		const encode = { preset: "generic", analyze: "async", postProcess: { transcribe: false, sceneDetection: false } };

		const first = await post(`/uploads/${fileId}/complete`, { encode });
		const second = await post(`/uploads/${fileId}/complete`, { encode });

		expect(first.status).toBe(202);
		expect(first.body.request).toMatchObject({ mode: "encode", status: "ANALYZING" });
		expect(second.status).toBe(200);
		expect(second.body.request.id).toBe(first.body.request.id);
	});

	it("answers 401 for an unknown API key", async () => {
		const fileId = await createFile();
		const res = await request(app)
			.post(`/uploads/${fileId}/complete`)
			.set("Authorization", bearer("sk_live_not_a_real_key_0000000000000000"))
			.send({ store: true });

		expect(res.status).toBe(401);
	});

	it("answers 400 when a multipart upload is completed without parts", async () => {
		jest.spyOn(objectStore(), "createMultipartUpload").mockResolvedValue("up-1");
		jest.spyOn(objectStore(), "objectInfo").mockResolvedValue(undefined);
		const created = await post(
			"/uploads",
			imageBody({ filename: "clip.mp4", sizeBytes: 12 * MiB, contentType: "video/mp4" })
		);

		const res = await post(`/uploads/${created.body.fileId}/complete`, { store: true });

		expect(res.status).toBe(400);
	});
});

describe("multipart parts and abort", () => {
	async function createMultipart(): Promise<string> {
		jest.spyOn(objectStore(), "createMultipartUpload").mockResolvedValue("up-1");
		const res = await post(
			"/uploads",
			imageBody({ filename: "clip.mp4", sizeBytes: 12 * MiB, contentType: "video/mp4" })
		);
		return res.body.fileId;
	}

	it("re-signs parts inside the planned count", async () => {
		const fileId = await createMultipart();

		const signed = await post(`/uploads/${fileId}/parts`, { partNumbers: [2] });
		const beyond = await post(`/uploads/${fileId}/parts`, { partNumbers: [9] });

		expect(signed.status).toBe(200);
		expect(signed.body.parts).toEqual([{ partNumber: 2, url: "https://signed.test/part" }]);
		expect(beyond.status).toBe(400);
	});

	it("lists the parts already uploaded", async () => {
		const fileId = await createMultipart();
		jest.spyOn(objectStore(), "listParts").mockResolvedValue([{ partNumber: 1, etag: '"a"', sizeBytes: 5 * MiB }]);

		const res = await request(app).get(`/uploads/${fileId}/parts`).set("Authorization", bearer(key));

		expect(res.status).toBe(200);
		expect(res.body.parts).toEqual([{ partNumber: 1, etag: '"a"', sizeBytes: 5 * MiB }]);
	});

	it("aborts a pending upload with 204 and marks the file failed", async () => {
		const fileId = await createMultipart();

		const res = await request(app).delete(`/uploads/${fileId}`).set("Authorization", bearer(key));
		const file = await files().findOne({ _id: fileId });

		expect(res.status).toBe(204);
		expect(file).toMatchObject({ status: "FAILED" } as Partial<FileRecord>);
	});
});

describe("files", () => {
	it("gets a stored file, lists it and deletes it with 200, then answers 404", async () => {
		const fileId = await createFile();
		await post(`/uploads/${fileId}/complete`, { store: true });

		const got = await request(app).get(`/files/${fileId}`).set("Authorization", bearer(key));
		const listed = await request(app).get("/files?contentTypePrefix=image/").set("Authorization", bearer(key));
		const deleted = await request(app).delete(`/files/${fileId}`).set("Authorization", bearer(key));
		const after = await request(app).get(`/files/${fileId}`).set("Authorization", bearer(key));

		expect(got.body.id).toBe(fileId);
		expect(listed.body.files.map((file: { id: string }) => file.id)).toEqual([fileId]);
		expect(deleted.status).toBe(200);
		expect(deleted.body).toEqual({ fileId });
		expect(after.status).toBe(404);
	});

	it("accepts a from-url file with 202 as PENDING and queues its ingest", async () => {
		const res = await post("/files/from-url", { url: "https://example.test/logo.png", externalId: "logo-1" });

		expect(res.status).toBe(202);
		expect(res.body).toMatchObject({ status: "PENDING", externalId: "logo-1", filename: "logo.png" });
		expect(jest.mocked(queueFor("lambda-ai").send)).toHaveBeenCalledWith({ body: { fileId: res.body.id } });
	});
});

describe("account upload policy", () => {
	it("reads the effective default policy, then sets and reads a narrower one", async () => {
		const initial = await request(app).get("/account/upload-policy").set("Authorization", bearer(key));
		const set = await put("/account/upload-policy", { allowedContentTypes: ["image/*"], maxBytes: 50 * MiB });
		const read = await request(app).get("/account/upload-policy").set("Authorization", bearer(key));

		expect(initial.body.allowedContentTypes).toEqual(["*/*"]);
		expect(set.status).toBe(200);
		expect(read.body).toEqual({ allowedContentTypes: ["image/*"], maxBytes: 50 * MiB });
	});

	it("rejects a policy whose maxBytes exceeds the server limit with 400", async () => {
		const res = await put("/account/upload-policy", { allowedContentTypes: ["*/*"], maxBytes: 1024 ** 5 });

		expect(res.status).toBe(400);
	});
});

function put(path: string, body: object) {
	return request(app).patch(path).set("Authorization", bearer(key)).send(body);
}
