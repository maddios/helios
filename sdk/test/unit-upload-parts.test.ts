import { PermissionError, ValidationError } from "../src/index.js";
import { clientWith } from "./helpers/client.js";
import { json, routedFetch, scriptedFetch } from "./helpers/fakeFetch.js";

const UPLOAD_KEY = "acme/uploads/0b1c2d3e-0000-4000-8000-000000000001/clip.mp4";

describe("uploads.signParts", () => {
	it("POSTs the key and part numbers to the upload's parts path and returns the fresh URLs", async () => {
		const response = { parts: [{ partNumber: 2, url: "https://s3.test/p2" }], expiresAt: "2026-10-20T06:00:00.000Z" };
		const { fetch, calls } = scriptedFetch([json(200, response)]);

		const result = await clientWith(fetch).uploads.signParts("u 1", UPLOAD_KEY, [2]);

		expect(result).toEqual(response);
		expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.test/uploads/multipart/u%201/parts" });
		expect(calls[0]?.body).toEqual({ uploadKey: UPLOAD_KEY, partNumbers: [2] });
	});

	it("maps a foreign upload key to PermissionError", async () => {
		const { fetch } = scriptedFetch([json(403, { error: { code: "forbidden", message: "no" } })]);

		await expect(clientWith(fetch).uploads.signParts("u1", UPLOAD_KEY, [1])).rejects.toThrow(PermissionError);
	});

	it("maps an out-of-range part number to ValidationError", async () => {
		const { fetch } = scriptedFetch([json(400, { error: { code: "validation_error", message: "bad" } })]);

		await expect(clientWith(fetch).uploads.signParts("u1", UPLOAD_KEY, [10001])).rejects.toThrow(ValidationError);
	});
});

describe("uploads.listParts", () => {
	it("GETs the parts with the upload key as a query parameter", async () => {
		const response = { parts: [{ partNumber: 1, etag: '"e1"', sizeBytes: 5 }] };
		const { fetch, calls } = routedFetch(() => json(200, response));

		const result = await clientWith(fetch).uploads.listParts("u1", UPLOAD_KEY);

		expect(result).toEqual(response);
		expect(calls[0]).toMatchObject({
			method: "GET",
			url: `https://api.test/uploads/multipart/u1/parts?uploadKey=${encodeURIComponent(UPLOAD_KEY)}`
		});
		expect(calls[0]?.body).toBeUndefined();
	});
});
