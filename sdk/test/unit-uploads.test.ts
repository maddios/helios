import { join } from "node:path";
import { Readable } from "node:stream";
import { AbortedError, UploadCompleteError, UploadError, ValidationError } from "../src/index.js";
import type { FetchFn, HeliosOptions } from "../src/options.js";
import { partitionChunks } from "../src/uploads/partition.js";
import { forEachBounded } from "../src/uploads/pool.js";
import { clientWith } from "./helpers/client.js";
import { bodyText, json, routedFetch, type Call } from "./helpers/fakeFetch.js";

const STORAGE = "https://s3.test";
const FILE_ID = "0b1c2d3e-0000-4000-8000-000000000001";
const EXPIRES_AT = "2026-10-20T06:00:00.000Z";
const PAYLOAD = Buffer.from("0123456789");
const STORED = {
	file: {
		id: FILE_ID,
		status: "STORED",
		url: "https://cdn.test/a.bin",
		filename: "a.bin",
		key: "k",
		createdAt: EXPIRES_AT
	}
};
const OPTIONS = { filename: "a.bin", contentType: "application/octet-stream" };

function multipart(partSizeBytes: number, count: number) {
	return {
		mode: "multipart",
		fileId: FILE_ID,
		key: `acme/files/${FILE_ID}/a.bin`,
		uploadId: "u1",
		partSizeBytes,
		parts: Array.from({ length: count }, (_, index) => ({
			partNumber: index + 1,
			url: `${STORAGE}/part/${index + 1}`
		})),
		expiresAt: EXPIRES_AT
	};
}

const SINGLE = {
	mode: "single",
	fileId: FILE_ID,
	key: `acme/files/${FILE_ID}/a.bin`,
	url: `${STORAGE}/put`,
	headers: { "Content-Type": "application/octet-stream" },
	expiresAt: EXPIRES_AT
};

function partOk(call: Call): Response {
	const partNumber = call.url.split("/").pop();
	return new Response(null, { status: 200, headers: { etag: `"etag-${partNumber}"` } });
}

function uploadsFor(fetch: FetchFn, overrides: Partial<HeliosOptions> = {}) {
	return clientWith(fetch, overrides).uploads;
}

function bytesOf(call: Call): Buffer {
	return Buffer.from(call.raw as Uint8Array);
}

function isCreate(call: Call): boolean {
	return call.method === "POST" && call.url.endsWith("/uploads");
}

function isComplete(call: Call): boolean {
	return call.method === "POST" && call.url.endsWith("/complete");
}

describe("upload with the multipart mode", () => {
	it("sends each part, then completes with the ordered ETags and the store target", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (isCreate(call)) return json(201, multipart(4, 3));
			if (call.method === "PUT") return partOk(call);
			return json(200, STORED);
		});

		const result = await uploadsFor(fetch).upload(PAYLOAD, { ...OPTIONS, store: true });

		const parts = calls.filter((call) => call.method === "PUT");
		expect(result.file.id).toBe(FILE_ID);
		expect(parts.map((call) => bytesOf(call).toString())).toEqual(["0123", "4567", "89"]);
		expect(calls.at(-1)).toMatchObject({
			url: expect.stringContaining(`/uploads/${FILE_ID}/complete`),
			body: {
				parts: [
					{ partNumber: 1, etag: '"etag-1"' },
					{ partNumber: 2, etag: '"etag-2"' },
					{ partNumber: 3, etag: '"etag-3"' }
				],
				store: true
			}
		});
	});

	it("keeps at most `concurrency` parts in flight", async () => {
		let inFlight = 0;
		let peak = 0;
		const { fetch } = routedFetch(async (call) => {
			if (isCreate(call)) return json(201, multipart(2, 6));
			if (call.method === "PUT") {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 5));
				inFlight -= 1;
				return partOk(call);
			}
			return json(200, STORED);
		});

		await uploadsFor(fetch).upload(Buffer.alloc(12), { ...OPTIONS, concurrency: 2, store: true });

		expect(peak).toBe(2);
	});

	it("reports progress after each part", async () => {
		const { fetch } = routedFetch((call) => {
			if (isCreate(call)) return json(201, multipart(4, 3));
			if (call.method === "PUT") return partOk(call);
			return json(200, STORED);
		});
		const seen: number[] = [];

		await uploadsFor(fetch).upload(PAYLOAD, {
			...OPTIONS,
			store: true,
			onProgress: ({ uploadedBytes }) => seen.push(uploadedBytes)
		});

		expect(seen.at(-1)).toBe(PAYLOAD.length);
		expect(seen).toEqual([...seen].sort((a, b) => a - b));
	});

	it("aborts the upload on the server when a part is rejected", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (isCreate(call)) return json(201, multipart(4, 3));
			if (call.method === "PUT") return new Response("denied", { status: 403 });
			return new Response(null, { status: 204 });
		});

		await expect(uploadsFor(fetch).upload(PAYLOAD, { ...OPTIONS, store: true })).rejects.toBeInstanceOf(UploadError);
		expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: expect.stringContaining(`/uploads/${FILE_ID}`) });
	});

	it("aborts the upload on the server and throws AbortedError when the signal fires", async () => {
		const controller = new AbortController();
		const { fetch, calls } = routedFetch(async (call) => {
			if (isCreate(call)) return json(201, multipart(4, 3));
			if (call.method === "PUT") {
				controller.abort();
				return partOk(call);
			}
			return new Response(null, { status: 204 });
		});

		await expect(
			uploadsFor(fetch).upload(PAYLOAD, { ...OPTIONS, store: true, signal: controller.signal })
		).rejects.toBeInstanceOf(AbortedError);
		expect(calls.at(-1)?.method).toBe("DELETE");
	});

	it("streams a Readable through multipart in exact part sizes", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (isCreate(call)) return json(201, multipart(4, 3));
			if (call.method === "PUT") return partOk(call);
			return json(200, STORED);
		});

		await uploadsFor(fetch).upload(Readable.from([Buffer.from("01"), Buffer.from("234"), Buffer.from("56789")]), {
			filename: "a.bin",
			sizeBytes: 10,
			contentType: "application/octet-stream",
			store: true
		});

		expect(calls.filter((call) => call.method === "PUT").map((call) => bytesOf(call).toString())).toEqual([
			"0123",
			"4567",
			"89"
		]);
	});
});

describe("upload with the single mode", () => {
	it("PUTs the bytes once with the content type, then completes with store", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (isCreate(call)) return json(201, SINGLE);
			if (call.method === "PUT") return new Response(null, { status: 200 });
			return json(200, STORED);
		});

		const result = await uploadsFor(fetch).upload(PAYLOAD, { ...OPTIONS, store: true });

		expect(result.file.status).toBe("STORED");
		expect(calls.map((call) => call.method)).toEqual(["POST", "PUT", "POST"]);
		expect(calls[1]).toMatchObject({
			url: `${STORAGE}/put`,
			headers: expect.objectContaining({ "content-type": "application/octet-stream" })
		});
		expect(bodyText(calls[2])).toBe('{"store":true}');
	});

	it("sends encode options with the complete call when the target is encode", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (isCreate(call)) return json(201, SINGLE);
			if (call.method === "PUT") return new Response(null, { status: 200 });
			return json(202, { ...STORED, request: { id: "r1", status: "ANALYZING" } });
		});

		await uploadsFor(fetch).upload(PAYLOAD, { ...OPTIONS, encode: { preset: "generic" } });

		expect(calls.at(-1)?.body).toEqual({ encode: { preset: "generic" } });
	});

	it("sends the policy and externalId with the create call", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (isCreate(call)) return json(201, SINGLE);
			if (call.method === "PUT") return new Response(null, { status: 200 });
			return json(200, STORED);
		});

		await uploadsFor(fetch).upload(PAYLOAD, {
			...OPTIONS,
			externalId: "clip-7",
			policy: { allowedContentTypes: ["image/*"], maxBytes: 1024 },
			store: true
		});

		expect(calls[0].body).toEqual({
			filename: "a.bin",
			sizeBytes: PAYLOAD.length,
			contentType: "application/octet-stream",
			externalId: "clip-7",
			policy: { allowedContentTypes: ["image/*"], maxBytes: 1024 }
		});
	});

	it("sends exactly the headers the server signed, not the content type alone", async () => {
		const signed = { ...SINGLE, headers: { "Content-Type": "text/html", "Content-Disposition": "attachment" } };
		const { fetch, calls } = routedFetch((call) => {
			if (isCreate(call)) return json(201, signed);
			if (call.method === "PUT") return new Response(null, { status: 200 });
			return json(200, STORED);
		});

		await uploadsFor(fetch).upload(PAYLOAD, { ...OPTIONS, contentType: "text/html", store: true });

		expect(calls[1].headers).toEqual({ "content-type": "text/html", "content-disposition": "attachment" });
	});

	it("throws UploadCompleteError with the file id when complete fails after the bytes were sent", async () => {
		const { fetch } = routedFetch((call) => {
			if (isCreate(call)) return json(201, SINGLE);
			if (call.method === "PUT") return new Response(null, { status: 200 });
			return json(422, { error: { code: "policy_violation", message: "not allowed" } });
		});

		const err = await uploadsFor(fetch)
			.upload(PAYLOAD, { ...OPTIONS, encode: { preset: "generic" } })
			.catch((caught: unknown) => caught);

		expect(err).toBeInstanceOf(UploadCompleteError);
		expect(err).toMatchObject({ fileId: FILE_ID, code: "policy_violation", status: 422 });
	});

	it("does not abort a single PUT that fails", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (isCreate(call)) return json(201, SINGLE);
			return new Response("denied", { status: 403 });
		});

		await expect(uploadsFor(fetch).upload(PAYLOAD, { ...OPTIONS, store: true })).rejects.toBeInstanceOf(UploadError);
		expect(calls.some((call) => call.method === "DELETE")).toBe(false);
	});
});

describe("file inputs", () => {
	it("requires a filename for a Buffer and a size for a stream", async () => {
		const { fetch } = routedFetch(() => json(201, SINGLE));
		const client = uploadsFor(fetch);

		await expect(client.upload(PAYLOAD, { contentType: "image/png", store: true })).rejects.toBeInstanceOf(
			ValidationError
		);
		await expect(
			client.upload(Readable.from([PAYLOAD]), { filename: "a.bin", contentType: "image/png", store: true })
		).rejects.toBeInstanceOf(ValidationError);
	});

	it("uses the basename of a file path as the filename", async () => {
		const { fetch, calls } = routedFetch((call) =>
			isCreate(call)
				? json(201, SINGLE)
				: call.method === "PUT"
					? new Response(null, { status: 200 })
					: json(200, STORED)
		);

		await uploadsFor(fetch).upload(join(__dirname, "..", "package.json"), {
			contentType: "application/json",
			store: true
		});

		expect(calls[0].body).toMatchObject({ filename: "package.json" });
	});
});

describe("partitionChunks and forEachBounded", () => {
	it("cuts uneven chunks into exact parts with a shorter last part", async () => {
		const parts: string[] = [];
		for await (const part of partitionChunks([Buffer.from("01"), Buffer.from("2345"), Buffer.from("6")], 3)) {
			parts.push(part.toString());
		}

		expect(parts).toEqual(["012", "345", "6"]);
	});

	it("stops starting new items after the first failure", async () => {
		const started: number[] = [];

		async function* items(): AsyncGenerator<number> {
			yield* [1, 2, 3, 4];
		}

		await expect(
			forEachBounded(items(), 1, async (item) => {
				started.push(item);
				if (item === 2) throw new Error("boom");
			})
		).rejects.toThrow("boom");

		expect(started).toEqual([1, 2]);
	});
});

describe("completion endpoints", () => {
	it("completes a file with the stored target and no parts for a single PUT", async () => {
		const { fetch, calls } = routedFetch(() => json(200, STORED));

		await uploadsFor(fetch).complete(FILE_ID, { store: true });

		expect(calls[0]).toMatchObject({
			method: "POST",
			url: expect.stringContaining(`/uploads/${FILE_ID}/complete`),
			body: { store: true }
		});
	});

	it("aborts a pending upload by file id", async () => {
		const { fetch, calls } = routedFetch(() => new Response(null, { status: 204 }));

		await uploadsFor(fetch).abort(FILE_ID);

		expect(calls[0]).toMatchObject({ method: "DELETE", url: expect.stringContaining(`/uploads/${FILE_ID}`) });
	});
});
