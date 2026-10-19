import { join } from "node:path";
import { Readable } from "node:stream";
import { AbortedError, UploadError, ValidationError } from "../src/index.js";
import type { FetchFn, HeliosOptions } from "../src/options.js";
import { partitionChunks } from "../src/uploads/partition.js";
import { forEachBounded } from "../src/uploads/pool.js";
import { clientWith } from "./helpers/client.js";
import { bodyText, json, routedFetch, type Call } from "./helpers/fakeFetch.js";
import { requestView } from "./helpers/fixtures.js";

const STORAGE = "https://s3.test";
const PAYLOAD = Buffer.from("0123456789");
const MULTIPART = { multipartThresholdBytes: 4 };

function multipartCreated(partSizeBytes: number, count: number) {
	return {
		uploadId: "u1",
		uploadKey: "uploads/acme/clip.bin",
		partSizeBytes,
		parts: Array.from({ length: count }, (_, index) => ({
			partNumber: index + 1,
			url: `${STORAGE}/part/${index + 1}`
		}))
	};
}

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

describe("multipart upload", () => {
	it("splits the input, uploads each part and completes with ordered ETags", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (call.method === "POST" && call.url.endsWith("/uploads/multipart")) return json(201, multipartCreated(4, 3));
			if (call.method === "PUT") return partOk(call);
			return json(200, { uploadKey: "uploads/acme/clip.bin" });
		});

		const key = await uploadsFor(fetch).upload(PAYLOAD, { ...MULTIPART, filename: "clip.bin" });

		const parts = calls.filter((call) => call.method === "PUT");
		expect(key).toBe("uploads/acme/clip.bin");
		expect(parts.map(bytesOf).map((bytes) => bytes.toString())).toEqual(["0123", "4567", "89"]);
		expect(calls.at(-1)?.body).toEqual({
			uploadKey: "uploads/acme/clip.bin",
			parts: [
				{ partNumber: 1, etag: '"etag-1"' },
				{ partNumber: 2, etag: '"etag-2"' },
				{ partNumber: 3, etag: '"etag-3"' }
			]
		});
	});

	it("keeps at most `concurrency` parts in flight", async () => {
		let inFlight = 0;
		let peak = 0;
		const { fetch } = routedFetch(async (call) => {
			if (call.method === "POST" && call.url.endsWith("/uploads/multipart")) return json(201, multipartCreated(2, 6));
			if (call.method === "PUT") {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 5));
				inFlight -= 1;
				return partOk(call);
			}
			return json(200, { uploadKey: "k" });
		});

		await uploadsFor(fetch).upload(Buffer.alloc(12), { ...MULTIPART, concurrency: 2, filename: "clip.bin" });

		expect(peak).toBe(2);
	});

	it("retries a failed part and then completes", async () => {
		let failedOnce = false;
		const { fetch, calls } = routedFetch((call) => {
			if (call.method === "POST" && call.url.endsWith("/uploads/multipart")) return json(201, multipartCreated(4, 3));
			if (call.url === `${STORAGE}/part/2` && !failedOnce) {
				failedOnce = true;
				return new Response("boom", { status: 500 });
			}
			if (call.method === "PUT") return partOk(call);
			return json(200, { uploadKey: "k" });
		});

		await uploadsFor(fetch).upload(PAYLOAD, { ...MULTIPART, filename: "clip.bin" });

		expect(calls.filter((call) => call.url === `${STORAGE}/part/2`)).toHaveLength(2);
		expect(calls.some((call) => call.url.includes("/complete"))).toBe(true);
		expect(calls.some((call) => call.method === "DELETE")).toBe(false);
	});

	it("reports progress after each part", async () => {
		const { fetch } = routedFetch((call) => {
			if (call.method === "POST" && call.url.endsWith("/uploads/multipart")) return json(201, multipartCreated(4, 3));
			if (call.method === "PUT") return partOk(call);
			return json(200, { uploadKey: "k" });
		});
		const progress: { uploadedBytes: number; totalBytes: number }[] = [];

		await uploadsFor(fetch).upload(PAYLOAD, {
			...MULTIPART,
			filename: "clip.bin",
			onProgress: (event) => progress.push(event)
		});

		const uploaded = progress.map((event) => event.uploadedBytes);
		expect(progress).toHaveLength(3);
		expect(uploaded).toEqual([...uploaded].sort((a, b) => a - b));
		expect(progress.at(-1)).toEqual({ uploadedBytes: 10, totalBytes: 10 });
	});

	it("aborts the upload on the server when a part is rejected", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (call.method === "POST" && call.url.endsWith("/uploads/multipart")) return json(201, multipartCreated(4, 3));
			if (call.url === `${STORAGE}/part/2`) return new Response("denied", { status: 403 });
			if (call.method === "PUT") return partOk(call);
			return new Response(null, { status: 204 });
		});

		const error = await uploadsFor(fetch)
			.upload(PAYLOAD, { ...MULTIPART, filename: "clip.bin" })
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(UploadError);
		expect(error).toMatchObject({ status: 403 });
		expect(calls.find((call) => call.method === "DELETE")?.url).toBe(
			`https://api.test/uploads/multipart/u1?uploadKey=uploads%2Facme%2Fclip.bin`
		);
		expect(calls.some((call) => call.url.includes("/complete"))).toBe(false);
	});

	it("aborts the upload on the server and throws AbortedError when the signal fires", async () => {
		const controller = new AbortController();
		const { fetch, calls } = routedFetch((call) => {
			if (call.method === "POST" && call.url.endsWith("/uploads/multipart")) return json(201, multipartCreated(4, 3));
			if (call.method === "PUT") {
				controller.abort();
				throw call.signal?.reason;
			}
			return new Response(null, { status: 204 });
		});

		const error = await uploadsFor(fetch)
			.upload(PAYLOAD, { ...MULTIPART, filename: "clip.bin", signal: controller.signal })
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(AbortedError);
		expect(calls.some((call) => call.method === "DELETE")).toBe(true);
	});

	it("streams a Readable and a Blob through multipart in exact part sizes", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (call.method === "POST" && call.url.endsWith("/uploads/multipart")) return json(201, multipartCreated(4, 3));
			if (call.method === "PUT") return partOk(call);
			return json(200, { uploadKey: "k" });
		});
		const client = uploadsFor(fetch);

		await client.upload(Readable.from([Buffer.from("012"), Buffer.from("34567"), Buffer.from("89")]), {
			...MULTIPART,
			filename: "clip.bin",
			sizeBytes: 10
		});
		await client.upload(new Blob([PAYLOAD]), { ...MULTIPART, filename: "blob.bin" });

		const puts = calls.filter((call) => call.method === "PUT").map((call) => bytesOf(call).toString());
		expect(puts).toEqual(["0123", "4567", "89", "0123", "4567", "89"]);
	});
});

describe("single presigned upload", () => {
	it("PUTs a small Buffer to a presigned URL and returns its key", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (call.url.endsWith("/uploads/presigned")) {
				return json(201, {
					uploadKey: "uploads/acme/a.txt",
					url: `${STORAGE}/single`,
					expiresAt: "2026-10-19T01:00:00.000Z"
				});
			}
			return new Response(null, { status: 200 });
		});

		const key = await uploadsFor(fetch).upload(Buffer.from("abc"), { filename: "a.txt", contentType: "text/plain" });

		expect(key).toBe("uploads/acme/a.txt");
		expect(calls[0]?.body).toEqual({ filename: "a.txt", sizeBytes: 3, contentType: "text/plain" });
		expect(calls[1]).toMatchObject({ method: "PUT", url: `${STORAGE}/single` });
		expect(calls[1]?.headers["content-type"]).toBe("text/plain");
		expect(bodyText(calls[1] as Call)).toBe("abc");
	});

	it("detects the size and basename of a file path", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (call.url.endsWith("/uploads/presigned")) {
				return json(201, { uploadKey: "k", url: `${STORAGE}/single`, expiresAt: "2026-10-19T01:00:00.000Z" });
			}
			return new Response(null, { status: 200 });
		});

		await uploadsFor(fetch).upload(join(__dirname, "../package.json"));

		expect(calls[0]?.body).toMatchObject({ filename: "package.json" });
		expect((calls[0]?.body as { sizeBytes: number }).sizeBytes).toBeGreaterThan(0);
	});

	it("requires a filename for a Buffer and a size for a stream", async () => {
		const { fetch } = routedFetch(() => json(500, {}));
		const uploads = uploadsFor(fetch);

		await expect(uploads.upload(Buffer.from("a"))).rejects.toMatchObject({ code: "filename_required" });
		await expect(uploads.upload(Readable.from([Buffer.from("a")]), { filename: "a" })).rejects.toBeInstanceOf(
			ValidationError
		);
		await expect(uploads.upload(Readable.from([Buffer.from("a")]), { filename: "a" })).rejects.toMatchObject({
			code: "size_required"
		});
	});
});

describe("uploadAndEncode", () => {
	it("uploads, then encodes the stored key with a generated requestId", async () => {
		const { fetch, calls } = routedFetch((call) => {
			if (call.url.endsWith("/uploads/presigned")) {
				return json(201, {
					uploadKey: "uploads/acme/a.mp4",
					url: `${STORAGE}/single`,
					expiresAt: "2026-10-19T01:00:00.000Z"
				});
			}
			if (call.url.endsWith("/encode")) return json(202, requestView("ANALYZING"));
			return new Response(null, { status: 200 });
		});

		const result = await uploadsFor(fetch).uploadAndEncode(Buffer.from("abc"), {
			filename: "a.mp4",
			preset: "generic",
			onProgress: () => undefined,
			externalId: "clip-1"
		});

		expect(result).toEqual({ uploadKey: "uploads/acme/a.mp4", request: requestView("ANALYZING") });
		const encodeBody = calls.find((call) => call.url.endsWith("/encode"))?.body as Record<string, unknown>;
		expect(encodeBody).toMatchObject({
			source: { uploadKey: "uploads/acme/a.mp4" },
			preset: "generic",
			externalId: "clip-1",
			requestId: expect.any(String)
		});
		expect(encodeBody).not.toHaveProperty("filename");
		expect(encodeBody).not.toHaveProperty("onProgress");
	});
});

describe("partitionChunks", () => {
	it("cuts uneven chunks into exact parts with a shorter last part", async () => {
		const parts: number[] = [];
		for await (const part of partitionChunks([Buffer.from("012"), Buffer.from("34567"), Buffer.from("89")], 4)) {
			parts.push(part.byteLength);
		}

		expect(parts).toEqual([4, 4, 2]);
	});
});

describe("forEachBounded", () => {
	it("stops starting new items after the first failure", async () => {
		const started: number[] = [];
		async function* items(): AsyncGenerator<number> {
			yield* [1, 2, 3, 4, 5];
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
