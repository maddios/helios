import { objectStore, type ObjectStore } from "@helios/core";
import * as render from "../../src/image/render";
import { handler, IMMUTABLE_CACHE_CONTROL } from "../../src/image/handler";
import { noisePng, solidPng, dimensionsOf } from "../helpers/images";

const KEY = "acme/media/a1/stills/still_0001.png";
const VARIANT_KEY = `resize_cache/${KEY}/_img/w_100,f_webp`;
const ETAG = '"etag-1"';
const INLINE_LIMIT_BYTES = ((6 * 1024 * 1024 - 64 * 1024) / 4) * 3;

describe("image handler", () => {
	let store: ObjectStore;
	let source: Buffer;

	beforeAll(async () => {
		source = await solidPng(300, 200, [40, 80, 120]);
	});

	beforeEach(() => {
		store = objectStore();
		jest.spyOn(store, "objectInfo").mockResolvedValue({ size: source.length, etag: ETAG });
		jest.spyOn(store, "downloadBuffer").mockResolvedValue(source);
		jest.spyOn(store, "uploadBuffer").mockResolvedValue(undefined);
		jest.spyOn(store, "deleteKeys").mockResolvedValue(undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("returns the variant inline and caches it under resize_cache", async () => {
		const response = await handler({ rawPath: `/${KEY}/_img/w_100,f_webp` });
		expect(response).toMatchObject({
			statusCode: 200,
			isBase64Encoded: true,
			headers: { "content-type": "image/webp", "cache-control": IMMUTABLE_CACHE_CONTROL }
		});
		expect(store.uploadBuffer).toHaveBeenCalledWith(
			VARIANT_KEY,
			expect.any(Buffer),
			"image/webp",
			IMMUTABLE_CACHE_CONTROL
		);
		const body = Buffer.from((response as { body: string }).body, "base64");
		expect(await dimensionsOf(body)).toEqual({ width: 100, height: 67 });
	});

	it("redirects a variant over the inline limit to its canonical url, keeping v", async () => {
		jest.spyOn(store, "downloadBuffer").mockResolvedValue(await noisePng(4096, 4096));
		const response = await handler({ rawPath: `/${KEY}/_img/w_4096,f_png`, rawQueryString: "v=3" });
		expect(response).toEqual({
			statusCode: 302,
			headers: { location: `/img/w_4096,f_png/${KEY}?v=3`, "cache-control": "no-store" }
		});
	});

	it.each([
		[INLINE_LIMIT_BYTES, 200],
		[INLINE_LIMIT_BYTES + 1, 302]
	])("switches to a redirect only above the base64 limit (%i bytes)", async (bytes, statusCode) => {
		jest.spyOn(render, "renderVariant").mockResolvedValue({
			body: Buffer.alloc(bytes),
			contentType: "image/png",
			format: "png"
		});
		const response = await handler({ rawPath: `/${KEY}/_img/w_100` });
		expect(response).toMatchObject({ statusCode });
	});

	it("returns 404 when the original is missing", async () => {
		jest.spyOn(store, "objectInfo").mockResolvedValue(undefined);
		expect(await handler({ rawPath: `/${KEY}/_img/w_100` })).toMatchObject({ statusCode: 404 });
	});

	it("returns 413 when the original exceeds IMAGE_MAX_SOURCE_BYTES", async () => {
		jest.spyOn(store, "objectInfo").mockResolvedValue({ size: 51 * 1024 * 1024, etag: ETAG });
		expect(await handler({ rawPath: `/${KEY}/_img/w_100` })).toMatchObject({ statusCode: 413 });
	});

	it("returns 415 when the original is not an image", async () => {
		jest.spyOn(store, "downloadBuffer").mockResolvedValue(Buffer.from("plain text"));
		expect(await handler({ rawPath: `/${KEY}/_img/w_100` })).toMatchObject({ statusCode: 415 });
	});

	it("removes its variant and returns 404 when the original is deleted during the render", async () => {
		jest
			.spyOn(store, "objectInfo")
			.mockResolvedValueOnce({ size: source.length, etag: ETAG })
			.mockResolvedValueOnce(undefined);

		const response = await handler({ rawPath: `/${KEY}/_img/w_100,f_webp` });

		expect(response).toEqual({
			statusCode: 404,
			headers: { "content-type": "application/json", "cache-control": "no-store" },
			body: JSON.stringify({ error: "not_found" })
		});
		expect(store.deleteKeys).toHaveBeenCalledWith([VARIANT_KEY]);
	});

	it("removes its variant and returns 404 when the original was replaced during the render", async () => {
		jest
			.spyOn(store, "objectInfo")
			.mockResolvedValueOnce({ size: source.length, etag: ETAG })
			.mockResolvedValueOnce({ size: source.length, etag: '"etag-2"' });

		expect(await handler({ rawPath: `/${KEY}/_img/w_100,f_webp` })).toMatchObject({ statusCode: 404 });
		expect(store.deleteKeys).toHaveBeenCalledWith([VARIANT_KEY]);
	});

	it("keeps the variant when the original is unchanged after the upload", async () => {
		await handler({ rawPath: `/${KEY}/_img/w_100,f_webp` });

		expect(store.deleteKeys).not.toHaveBeenCalled();
	});

	it("returns 400 for a disallowed key", async () => {
		const response = await handler({ rawPath: "/acme/sources/a1/original/_img/w_100" });
		expect(response).toMatchObject({ statusCode: 400, body: JSON.stringify({ error: "invalid_key" }) });
	});

	it("returns 400 for parameters that are not in canonical order", async () => {
		const response = await handler({ rawPath: `/${KEY}/_img/h_100,w_100` });
		expect(response).toMatchObject({ statusCode: 400, body: JSON.stringify({ error: "non_canonical" }) });
	});

	it("never touches the store for an invalid path", async () => {
		await handler({ rawPath: `/${KEY}/_img/q_80` });
		expect(store.objectInfo).not.toHaveBeenCalled();
	});
});
