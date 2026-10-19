import request from "supertest";
import { ensureIndexes, objectStore } from "@helios/core";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { bearer, seedAccount, seedGenericPreset } from "./helpers/fixtures";
import { mockObjectStore } from "./helpers/apiMocks";

const app = createApp();
const OWN_KEY = "acme/uploads/0b1c2d3e-0000-4000-8000-000000000001/clip.mp4";
const FOREIGN_KEY = "globex/uploads/0b1c2d3e-0000-4000-8000-000000000001/clip.mp4";

let key: string;

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	mockObjectStore();
	({ key } = await seedAccount());
});

function sign(body: object, uploadId = "up-1") {
	return request(app).post(`/uploads/multipart/${uploadId}/parts`).set("Authorization", bearer(key)).send(body);
}

function list(query: string, uploadId = "up-1") {
	return request(app).get(`/uploads/multipart/${uploadId}/parts${query}`).set("Authorization", bearer(key));
}

describe("POST /uploads/multipart/:uploadId/parts", () => {
	it("returns a presigned URL per requested part with an expiry", async () => {
		const res = await sign({ uploadKey: OWN_KEY, partNumbers: [2, 5] });

		expect(res.status).toBe(200);
		expect(res.body.parts).toEqual([
			{ partNumber: 2, url: "https://signed.test/part" },
			{ partNumber: 5, url: "https://signed.test/part" }
		]);
		expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
		expect(objectStore().presignPart).toHaveBeenCalledWith(OWN_KEY, "up-1", 2, expect.any(Number));
	});

	it.each([
		["an empty list", []],
		["a part number of 0", [0]],
		["a part number above 10000", [10001]],
		["a non-integer part number", [1.5]],
		["duplicate part numbers", [3, 3]],
		["more than 1000 part numbers", Array.from({ length: 1001 }, (_, index) => index + 1)]
	])("rejects %s with 400", async (_label, partNumbers) => {
		const res = await sign({ uploadKey: OWN_KEY, partNumbers });

		expect(res.status).toBe(400);
		expect(objectStore().presignPart).not.toHaveBeenCalled();
	});

	it("accepts 1000 part numbers and the boundary numbers 1 and 10000", async () => {
		const partNumbers = [1, 10000, ...Array.from({ length: 998 }, (_, index) => index + 2)];

		expect((await sign({ uploadKey: OWN_KEY, partNumbers })).status).toBe(200);
	});

	it("rejects an upload key owned by another account with 403", async () => {
		const res = await sign({ uploadKey: FOREIGN_KEY, partNumbers: [1] });

		expect(res.status).toBe(403);
		expect(objectStore().presignPart).not.toHaveBeenCalled();
	});

	it("requires an account key", async () => {
		const res = await request(app)
			.post("/uploads/multipart/up-1/parts")
			.send({ uploadKey: OWN_KEY, partNumbers: [1] });

		expect(res.status).toBe(401);
	});
});

describe("GET /uploads/multipart/:uploadId/parts", () => {
	it("lists the uploaded parts of an owned upload", async () => {
		jest.mocked(objectStore().listParts).mockResolvedValue([{ partNumber: 1, etag: '"etag-1"', sizeBytes: 5242880 }]);

		const res = await list(`?uploadKey=${encodeURIComponent(OWN_KEY)}`);

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ parts: [{ partNumber: 1, etag: '"etag-1"', sizeBytes: 5242880 }] });
		expect(objectStore().listParts).toHaveBeenCalledWith(OWN_KEY, "up-1");
	});

	it("returns an empty list when no part is stored yet", async () => {
		jest.mocked(objectStore().listParts).mockResolvedValue([]);

		expect((await list(`?uploadKey=${encodeURIComponent(OWN_KEY)}`)).body).toEqual({ parts: [] });
	});

	it("rejects an upload key owned by another account with 403", async () => {
		const res = await list(`?uploadKey=${encodeURIComponent(FOREIGN_KEY)}`);

		expect(res.status).toBe(403);
		expect(objectStore().listParts).not.toHaveBeenCalled();
	});

	it("requires the uploadKey query parameter", async () => {
		expect((await list("")).status).toBe(400);
	});
});
