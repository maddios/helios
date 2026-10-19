import { routeImageUri, type ImageRoute } from "../../src/images";
import { handler as edgeHandler, type EdgeResponse } from "../../../infra/edge/imgRewrite";

const key = "acme/media/a1/still.jpg";

const TABLE: [string, ImageRoute][] = [
	[`/img/w_320,h_180,c_fill/${key}`, { kind: "rewrite", uri: `/${key}/_img/w_320,h_180,c_fill` }],
	[`/img/w_320/${key}`, { kind: "rewrite", uri: `/${key}/_img/w_320` }],
	[
		`/img/w_100,c_pad,b_ff0000,q_90,f_png/${key}`,
		{ kind: "rewrite", uri: `/${key}/_img/w_100,c_pad,b_ff0000,q_90,f_png` }
	],
	[`/img/h_180,w_320/${key}`, { kind: "redirect", location: `/img/w_320,h_180/${key}` }],
	[`/img/q_90,w_100,f_webp/${key}`, { kind: "redirect", location: `/img/w_100,q_90,f_webp/${key}` }],
	[`/img/w_100,c_pad,b_ff0000/${key}`, { kind: "rewrite", uri: `/${key}/_img/w_100,c_pad,b_ff0000` }],
	[`/img/w_100,b_ff0000/${key}`, { kind: "invalid", code: "not_applicable" }],
	[`/img/w_100,g_north/${key}`, { kind: "invalid", code: "not_applicable" }],
	[`/img/w_100,c_fill,g_north/${key}`, { kind: "rewrite", uri: `/${key}/_img/w_100,c_fill,g_north` }],
	[`/img/w_100,c_pad,b_FF0000/${key}`, { kind: "invalid", code: "invalid_value" }],
	[`/img/w_100,c_fit/${key}`, { kind: "redirect", location: `/img/w_100/${key}` }],
	[`/img/c_fit,w_100/${key}`, { kind: "redirect", location: `/img/w_100/${key}` }],
	[`/img/w_01/${key}`, { kind: "invalid", code: "invalid_value" }],
	[`/img/w_100/acme/media/a1/_img/w_1/x.jpg`, { kind: "rewrite", uri: `/acme/media/a1/_img/w_1/x.jpg/_img/w_100` }],
	[`/img/w_100/acme/media/%2e%2e/x.jpg`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media/a%2Fb.jpg`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media/ünï.jpg`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media/./x.jpg`, { kind: "invalid", code: "invalid_key" }],
	[`/img/q_80/${key}`, { kind: "invalid", code: "missing_dimension" }],
	[`/img/w_0/${key}`, { kind: "invalid", code: "invalid_value" }],
	[`/img/w_4097/${key}`, { kind: "invalid", code: "invalid_value" }],
	[`/img/w_100,w_200/${key}`, { kind: "invalid", code: "duplicate_param" }],
	[`/img/x_1,w_100/${key}`, { kind: "invalid", code: "unknown_param" }],
	[`/img/w_100,f_auto/${key}`, { kind: "invalid", code: "invalid_value" }],
	[`/img/w_100,,h_1/${key}`, { kind: "invalid", code: "malformed_param" }],
	[`/img/w_100/acme/sources/a1/original`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/uploads/u1/part`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media/../sources/x`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media//x`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/acme/media/`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100/ACME/media/x`, { kind: "invalid", code: "invalid_key" }],
	[`/img/w_100`, { kind: "invalid", code: "invalid_path" }]
];

type EdgeOutcome = { kind: "rewrite"; uri: string } | { kind: "redirect"; location: string } | { kind: "invalid" };

function edgeRoute(uri: string): EdgeOutcome {
	const result = edgeHandler({ request: { method: "GET", uri, querystring: {}, headers: {} } });
	if (!("statusCode" in result)) {
		return { kind: "rewrite", uri: result.uri };
	}
	const response = result as EdgeResponse;
	return response.statusCode === 301
		? { kind: "redirect", location: response.headers.location.value }
		: { kind: "invalid" };
}

describe("edge rewrite parity with core routeImageUri", () => {
	it.each(TABLE)("%s", (uri, expected) => {
		expect(routeImageUri(uri)).toEqual(expected);
		expect(edgeRoute(uri)).toEqual(expected.kind === "invalid" ? { kind: "invalid" } : expected);
	});

	it("passes non-image paths through unchanged", () => {
		const result = edgeHandler({
			request: { method: "GET", uri: "/acme/media/a1/x.jpg", querystring: {}, headers: {} }
		});
		expect(result).toEqual(expect.objectContaining({ uri: "/acme/media/a1/x.jpg" }));
	});
});
