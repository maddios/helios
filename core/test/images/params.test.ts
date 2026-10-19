import { canonicalParams, parseImageParams, type ImageErrorCode } from "../../src/images";
import { errorCode } from "./helpers";

describe("parseImageParams", () => {
	it.each([
		["w_320", { w: 320 }],
		["w_4096", { w: 4096 }],
		["h_1,q_1", { h: 1, q: 1 }],
		["w_100,h_50,c_fill,g_southwest,q_100,f_avif", { w: 100, h: 50, c: "fill", g: "southwest", q: 100, f: "avif" }],
		["w_100,c_pad,b_ff0000", { w: 100, c: "pad", b: "ff0000" }],
		["w_100,c_fit", { w: 100, c: "fit" }],
		["w_100,c_fit,h_50", { w: 100, h: 50, c: "fit" }],
		["w_100,c_limit,f_webp", { w: 100, c: "limit", f: "webp" }],
		["w_100,f_jpg", { w: 100, f: "jpg" }],
		["w_100,f_png", { w: 100, f: "png" }]
	])("parses %s", (segment, expected) => {
		expect(parseImageParams(segment)).toEqual(expected);
	});

	it.each<[string, ImageErrorCode]>([
		["w_0", "invalid_value"],
		["w_4097", "invalid_value"],
		["w_01", "invalid_value"],
		["w_10000", "invalid_value"],
		["w_abc", "invalid_value"],
		["q_0", "invalid_value"],
		["q_101", "invalid_value"],
		["h_-1", "invalid_value"],
		["w_100,f_gif", "invalid_value"],
		["w_100,f_auto", "invalid_value"],
		["w_100,c_crop", "invalid_value"],
		["w_100,c_pad,b_FF0000", "invalid_value"],
		["w_100,c_pad,b_fff", "invalid_value"],
		["w_01", "invalid_value"],
		["h_0", "invalid_value"],
		["w_100,c_fill,g_nowhere", "invalid_value"],
		["w_", "malformed_param"],
		["w", "malformed_param"],
		["w_100,,h_50", "malformed_param"],
		["W_100", "malformed_param"],
		["x_1,w_100", "unknown_param"],
		["w_100,w_200", "duplicate_param"],
		["w_100,c_fit,c_fill", "duplicate_param"],
		["q_80", "missing_dimension"],
		["c_fit", "missing_dimension"],
		["w_100,b_ff0000", "not_applicable"],
		["w_100,c_fit,b_ff0000", "not_applicable"],
		["w_100,g_north", "not_applicable"],
		["w_100,c_pad,g_north", "not_applicable"]
	])("rejects %s with %s", (segment, code) => {
		expect(errorCode(() => parseImageParams(segment))).toBe(code);
	});
});

describe("canonicalParams", () => {
	it.each([
		["h_180,w_320", "w_320,h_180"],
		["f_webp,q_80,c_fit,h_100,w_200", "w_200,h_100,q_80,f_webp"],
		["q_90,b_00ff00,c_pad,w_10", "w_10,c_pad,b_00ff00,q_90"],
		["g_north,c_fill,w_10", "w_10,c_fill,g_north"],
		["f_png,w_1", "w_1,f_png"],
		["w_100,c_fit", "w_100"],
		["c_fit,h_50,w_100", "w_100,h_50"],
		["w_100,c_fill", "w_100,c_fill"]
	])("orders %s as %s", (segment, canonical) => {
		expect(canonicalParams(parseImageParams(segment))).toBe(canonical);
	});

	it("round-trips a canonical segment unchanged", () => {
		const segment = "w_10,h_20,c_pad,b_00ff00,q_90,f_avif";
		expect(canonicalParams(parseImageParams(segment))).toBe(segment);
	});
});
