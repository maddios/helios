import { PermissionError, ValidationError } from "../src/index.js";
import { clientWith } from "./helpers/client.js";
import { apiError, json, routedFetch } from "./helpers/fakeFetch.js";

const FILE_ID = "0b1c2d3e-0000-4000-8000-000000000001";

function uploads(fetch: Parameters<typeof clientWith>[0]) {
	return clientWith(fetch).uploads;
}

describe("uploads.signParts", () => {
	it("POSTs the part numbers to the file's parts path and returns the fresh URLs", async () => {
		const { fetch, calls } = routedFetch(() =>
			json(200, { parts: [{ partNumber: 2, url: "https://s3.test/part/2" }], expiresAt: "2026-10-20T06:00:00.000Z" })
		);

		const { parts } = await uploads(fetch).signParts(FILE_ID, [2]);

		expect(parts).toEqual([{ partNumber: 2, url: "https://s3.test/part/2" }]);
		expect(calls[0]).toMatchObject({
			method: "POST",
			url: expect.stringContaining(`/uploads/${FILE_ID}/parts`),
			body: { partNumbers: [2] }
		});
	});

	it("maps an out-of-range part number to ValidationError", async () => {
		const { fetch } = routedFetch(() => apiError(400, "validation_failed"));

		await expect(uploads(fetch).signParts(FILE_ID, [10001])).rejects.toBeInstanceOf(ValidationError);
	});

	it("maps a file that belongs to another account to PermissionError", async () => {
		const { fetch } = routedFetch(() => apiError(403, "forbidden"));

		await expect(uploads(fetch).signParts(FILE_ID, [1])).rejects.toBeInstanceOf(PermissionError);
	});
});

describe("uploads.listParts", () => {
	it("GETs the parts of the file", async () => {
		const { fetch, calls } = routedFetch(() => json(200, { parts: [{ partNumber: 1, etag: '"a"', sizeBytes: 5 }] }));

		const { parts } = await uploads(fetch).listParts(FILE_ID);

		expect(parts).toEqual([{ partNumber: 1, etag: '"a"', sizeBytes: 5 }]);
		expect(calls[0]).toMatchObject({ method: "GET", url: expect.stringContaining(`/uploads/${FILE_ID}/parts`) });
	});
});
