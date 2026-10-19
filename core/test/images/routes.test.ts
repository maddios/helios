import {
	canonicalPath,
	imageUrl,
	isTransformableKey,
	parseRewrittenPath,
	rewrittenPath,
	routeImageUri,
	type ImageRoute
} from "../../src/images";
import { errorCode } from "./helpers";

describe("isTransformableKey", () => {
	it.each([
		"acme/media/a1/stills/still_0001.jpg",
		"acme-2/files/a1/thing.png",
		"acme/media/a1/original",
		"acme/media/a1/_img/w_1/x.jpg",
		"acme/files/x"
	])("allows %s", (key) => {
		expect(isTransformableKey(key)).toBe(true);
	});

	it.each([
		"acme/sources/a1/original",
		"acme/uploads/u1/part",
		"acme/media/a1/sources/x",
		"acme/files/uploads/x",
		"acme/media/../sources/x",
		"acme/media/a1/..",
		"acme/media//x",
		"acme/media/a1/",
		"acme/media/",
		"acme/media",
		"acme/media/./x",
		"acme/media/a1/.",
		"acme/media/%2e%2e/x",
		"acme/media/a%2Fb",
		"acme/media/ünï.jpg",
		"acme/media/a b.jpg",
		"acme/other/x",
		"ACME/media/x",
		"/acme/media/x",
		"acme_x/media/x",
		""
	])("denies %s", (key) => {
		expect(isTransformableKey(key)).toBe(false);
	});
});

describe("routeImageUri", () => {
	const key = "acme/media/a1/still.jpg";

	it.each<[string, ImageRoute]>([
		[`/img/w_320,h_180,c_fill/${key}`, { kind: "rewrite", uri: `/${key}/_img/w_320,h_180,c_fill` }],
		[`/img/w_320/${key}`, { kind: "rewrite", uri: `/${key}/_img/w_320` }],
		[`/img/h_180,w_320/${key}`, { kind: "redirect", location: `/img/w_320,h_180/${key}` }],
		[`/img/w_320,c_fit/${key}`, { kind: "redirect", location: `/img/w_320/${key}` }],
		[`/img/w_320,q_80,f_webp/${key}`, { kind: "rewrite", uri: `/${key}/_img/w_320,q_80,f_webp` }],
		[`/img/f_webp,q_80,w_320/${key}`, { kind: "redirect", location: `/img/w_320,q_80,f_webp/${key}` }],
		[`/img/w_320,c_fill/sources/x`, { kind: "invalid", code: "invalid_key" }],
		[`/img/w_320,c_fill/acme/sources/a1/original`, { kind: "invalid", code: "invalid_key" }],
		[`/img/w_0/${key}`, { kind: "invalid", code: "invalid_value" }],
		[`/img/w_320`, { kind: "invalid", code: "invalid_path" }],
		[`/other/w_320/${key}`, { kind: "invalid", code: "invalid_path" }]
	])("routes %s", (uri, expected) => {
		expect(routeImageUri(uri)).toEqual(expected);
	});
});

describe("parseRewrittenPath", () => {
	const key = "acme/media/a1/still.jpg";

	it("parses a rewritten canonical path", () => {
		expect(parseRewrittenPath(`/${key}/_img/w_320,c_fill`)).toEqual({
			key,
			transform: { w: 320, c: "fill" }
		});
	});

	it.each([
		[`/${key}/_img/h_180,w_320`, "non_canonical"],
		[`/${key}/_img/w_320,f_gif`, "invalid_value"],
		[`/${key}/_img/w_320,c_fit`, "non_canonical"],
		[`/acme/sources/a1/original/_img/w_320`, "invalid_key"],
		[`/${key}/w_320`, "invalid_path"],
		[`${key}/_img/w_320`, "invalid_path"]
	])("rejects %s with %s", (uri, code) => {
		expect(errorCode(() => parseRewrittenPath(uri))).toBe(code);
	});

	it("keeps the canonical form of a rewritten path without c_fit", () => {
		expect(rewrittenPath(key, { w: 320, c: "fit" })).toBe(`/${key}/_img/w_320`);
	});

	it("round-trips rewrittenPath", () => {
		const transform = { w: 10, h: 20, c: "pad" as const, b: "ffffff" };
		expect(parseRewrittenPath(rewrittenPath(key, transform))).toEqual({ key, transform });
		expect(canonicalPath(key, transform)).toBe(`/img/w_10,h_20,c_pad,b_ffffff/${key}`);
	});
});

describe("imageUrl", () => {
	const key = "acme/media/a1/still.jpg";

	it("builds a canonical url under IMAGE_BASE_URL", () => {
		expect(imageUrl(key, { h: 180, w: 320, c: "fill" })).toBe(`https://img.test.invalid/img/w_320,h_180,c_fill/${key}`);
	});

	it("appends the version as v", () => {
		expect(imageUrl(key, { w: 320 }, 7)).toBe(`https://img.test.invalid/img/w_320/${key}?v=7`);
	});

	it("rejects keys that are not transformable", () => {
		expect(errorCode(() => imageUrl("acme/sources/a1/original", { w: 320 }))).toBe("invalid_key");
	});
});
