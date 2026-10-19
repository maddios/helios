import type { ImageRoute, ImageTransform } from "../../src";

/** Storage key every table row uses. */
export const SHARED_KEY = "acme/media/a1/still.jpg";

/** Request URI and the route core and the edge function must both produce for it. */
export const ROUTE_TABLE: [string, ImageRoute][] = [
	[`/img/w_320,h_180,c_fill/${SHARED_KEY}`, { kind: "rewrite", uri: `/${SHARED_KEY}/_img/w_320,h_180,c_fill` }],
	[`/img/w_320/${SHARED_KEY}`, { kind: "rewrite", uri: `/${SHARED_KEY}/_img/w_320` }],
	[
		`/img/w_100,c_pad,b_ff0000,q_90,f_png/${SHARED_KEY}`,
		{ kind: "rewrite", uri: `/${SHARED_KEY}/_img/w_100,c_pad,b_ff0000,q_90,f_png` }
	],
	[`/img/h_180,w_320/${SHARED_KEY}`, { kind: "redirect", location: `/img/w_320,h_180/${SHARED_KEY}` }],
	[`/img/q_90,w_100,f_webp/${SHARED_KEY}`, { kind: "redirect", location: `/img/w_100,q_90,f_webp/${SHARED_KEY}` }],
	[`/img/w_100,c_pad,b_ff0000/${SHARED_KEY}`, { kind: "rewrite", uri: `/${SHARED_KEY}/_img/w_100,c_pad,b_ff0000` }],
	[`/img/w_100,b_ff0000/${SHARED_KEY}`, { kind: "invalid", code: "not_applicable" }],
	[`/img/w_100,g_north/${SHARED_KEY}`, { kind: "invalid", code: "not_applicable" }],
	[`/img/w_100,c_fill,g_north/${SHARED_KEY}`, { kind: "rewrite", uri: `/${SHARED_KEY}/_img/w_100,c_fill,g_north` }],
	[`/img/w_100,c_pad,b_FF0000/${SHARED_KEY}`, { kind: "invalid", code: "invalid_value" }],
	[`/img/w_100,c_fit/${SHARED_KEY}`, { kind: "redirect", location: `/img/w_100/${SHARED_KEY}` }],
	[`/img/c_fit,w_100/${SHARED_KEY}`, { kind: "redirect", location: `/img/w_100/${SHARED_KEY}` }],
	[`/img/w_01/${SHARED_KEY}`, { kind: "invalid", code: "invalid_value" }],
	[`/img/w_100/acme/media/a1/_img/w_1/x.jpg`, { kind: "rewrite", uri: `/acme/media/a1/_img/w_1/x.jpg/_img/w_100` }],
	[`/img/w_100/acme/media/%2e%2e/x.jpg`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media/a%2Fb.jpg`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media/ünï.jpg`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media/./x.jpg`, { kind: "invalid", code: "invalid_key" }],
	[`/img/q_80/${SHARED_KEY}`, { kind: "invalid", code: "missing_dimension" }],
	[`/img/w_0/${SHARED_KEY}`, { kind: "invalid", code: "invalid_value" }],
	[`/img/w_4097/${SHARED_KEY}`, { kind: "invalid", code: "invalid_value" }],
	[`/img/w_100,w_200/${SHARED_KEY}`, { kind: "invalid", code: "duplicate_param" }],
	[`/img/x_1,w_100/${SHARED_KEY}`, { kind: "invalid", code: "unknown_param" }],
	[`/img/w_100,f_auto/${SHARED_KEY}`, { kind: "invalid", code: "invalid_value" }],
	[`/img/w_100,,h_1/${SHARED_KEY}`, { kind: "invalid", code: "malformed_param" }],
	[`/img/w_100/acme/sources/a1/original`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/uploads/u1/part`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media/../sources/x`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media//x`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media/`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/ACME/media/x`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100`, { kind: "invalid", code: "invalid_path" }]
];

/** Transforms every builder must canonicalise identically, in the core's transform shape. */
export const VALID_TRANSFORMS: [string, ImageTransform][] = [
	["width only", { w: 320 }],
	["width and height in canonical order", { h: 180, w: 320 }],
	["fit is implicit", { w: 100, q: 90 }],
	["pad with colour, quality and format", { w: 100, c: "pad", b: "ff0000", q: 90, f: "png" }],
	["pad without colour", { h: 50, c: "pad" }],
	["format only", { w: 320, f: "webp" }],
	["max dimension", { w: 4096, h: 4096 }],
	["quality bounds", { w: 1, q: 1 }],
	["quality 100", { w: 1, q: 100 }]
];

/** Transforms every builder must reject, with the code the core reports. */
export const INVALID_TRANSFORMS: [string, ImageTransform, string][] = [
	["no dimension", { q: 80 }, "missing_dimension"],
	["zero width", { w: 0 }, "invalid_value"],
	["width above the maximum", { w: 4097 }, "invalid_value"],
	["fractional height", { h: 1.5 }, "invalid_value"],
	["quality above 100", { w: 10, q: 101 }, "invalid_value"],
	["unknown format", { w: 10, f: "gif" as ImageTransform["f"] }, "invalid_value"],
	["upper-case colour", { w: 10, c: "pad", b: "FF0000" }, "invalid_value"],
	["colour without pad", { w: 10, b: "ff0000" }, "not_applicable"]
];
