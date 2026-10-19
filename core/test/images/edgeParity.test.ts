import { routeImageUri } from "../../src/images";
import { ROUTE_TABLE } from "../../../contracts/test/images/sharedTable";
import { handler as edgeHandler, type EdgeResponse } from "../../../infra/edge/imgRewrite";

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
	it.each(ROUTE_TABLE)("%s", (uri, expected) => {
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
